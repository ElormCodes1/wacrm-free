-- ============================================================
-- 084_preview_never_goes_backwards.sql — keep the inbox preview on the
-- newest message
--
-- Every place that wrote a conversation preview stamped
-- `last_message_at = now()` — the moment the event was PROCESSED, not the
-- moment the message was sent. For live traffic those are seconds apart
-- and nobody notices. For anything replayed or delayed they are hours
-- apart, and two things follow:
--
--   a backlog message from earlier arrives, stamps itself now(), and
--   sorts to the TOP of the inbox carrying old text
--
--   the preview moves BACKWARDS, because the update is unconditional and
--   whichever event is processed last wins regardless of age
--
-- A conversation list is ordered by when people spoke, not by when our
-- webhook got round to it. So the message's own timestamp is used, and
-- the preview is only moved when the message really is the newest.
--
-- `unread_count` is still incremented either way: a message that arrives
-- late is still unread, whatever order it turns up in.
--
-- Replaces the function from migration 082; everything else about it is
-- unchanged.
-- ============================================================

begin;

create or replace function public.whatsapp_ingest_inbound(
  p_account_id          uuid,
  p_user_id             uuid,
  p_whatsapp_config_id  uuid,
  p_remote_jid          text,
  p_phone               text,
  p_contact_name        text,
  p_message_id          text,
  p_content_type        text,
  p_content_text        text,
  p_media_pending       boolean,
  p_created_at          timestamptz,
  p_interactive_reply_id text,
  p_mentions            jsonb,
  p_reply_to_meta_id    text,
  p_is_history          boolean,
  p_insert_message      boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contact           contacts%rowtype;
  v_contact_created   boolean := false;
  v_prior_avatar      text;
  v_was_on_whatsapp   boolean;
  v_conversation      conversations%rowtype;
  v_conv_created      boolean := false;
  v_reply_to          uuid;
  v_is_first_inbound  boolean;
  v_message_row_id    uuid;
begin
  if p_is_history and exists (
    select 1 from messages where message_id = p_message_id limit 1
  ) then
    return jsonb_build_object('deduped', true);
  end if;

  -- chat_numbers is recorded by the caller for every inbound event, group
  -- and status included, so it is deliberately not written here.

  -- ---------- contact ----------
  select * into v_contact
  from contacts
  where account_id = p_account_id and phone_normalized = regexp_replace(p_phone, '\D', '', 'g')
  limit 1;

  if not found then
    begin
      insert into contacts (account_id, user_id, phone, name, is_on_whatsapp, whatsapp_checked_at)
      values (p_account_id, p_user_id, p_phone, coalesce(nullif(btrim(p_contact_name), ''), p_phone), true, now())
      returning * into v_contact;
      v_contact_created := true;
    exception when unique_violation then
      select * into v_contact
      from contacts
      where account_id = p_account_id and phone_normalized = regexp_replace(p_phone, '\D', '', 'g')
      limit 1;
    end;
  end if;

  if v_contact.id is null then
    return jsonb_build_object('error', 'contact-unresolved');
  end if;

  v_prior_avatar := v_contact.avatar_url;
  v_was_on_whatsapp := case when v_contact_created then null
                            else v_contact.is_on_whatsapp end;

  if not v_contact_created and v_contact.is_on_whatsapp is distinct from true then
    update contacts
       set is_on_whatsapp = true, whatsapp_checked_at = now(), updated_at = now()
     where id = v_contact.id;
  end if;

  -- ---------- conversation ----------
  select * into v_conversation
  from conversations
  where account_id = p_account_id and contact_id = v_contact.id
  order by created_at asc
  limit 1;

  if not found then
    begin
      insert into conversations (account_id, user_id, contact_id, whatsapp_config_id)
      values (p_account_id, p_user_id, v_contact.id, p_whatsapp_config_id)
      returning * into v_conversation;
      v_conv_created := true;
    exception when unique_violation then
      select * into v_conversation
      from conversations
      where account_id = p_account_id and contact_id = v_contact.id
      order by created_at asc
      limit 1;
    end;
  elsif p_whatsapp_config_id is not null
        and v_conversation.whatsapp_config_id is distinct from p_whatsapp_config_id then
    update conversations set whatsapp_config_id = p_whatsapp_config_id
     where id = v_conversation.id;
    v_conversation.whatsapp_config_id := p_whatsapp_config_id;
  end if;

  if v_conversation.id is null then
    return jsonb_build_object('error', 'conversation-unresolved');
  end if;

  if not p_insert_message then
    return jsonb_build_object(
      'deduped', false,
      'contact_id', v_contact.id,
      'contact_created', v_contact_created,
      'contact_avatar_url', v_prior_avatar,
      'contact_was_on_whatsapp', v_was_on_whatsapp,
      'conversation_id', v_conversation.id,
      'conversation_created', v_conv_created,
      'message_row_id', null,
      'is_first_inbound', false
    );
  end if;

  if p_reply_to_meta_id is not null then
    select id into v_reply_to
    from messages
    where conversation_id = v_conversation.id and message_id = p_reply_to_meta_id
    limit 1;
  end if;

  select not exists (
    select 1 from messages
    where conversation_id = v_conversation.id
      and sender_type = 'customer'
      and (message_id is null or message_id <> p_message_id)
    limit 1
  ) into v_is_first_inbound;

  insert into messages (
    conversation_id, sender_type, content_type, content_text, media_url,
    media_status, message_id, status, created_at, reply_to_message_id,
    interactive_reply_id, mentions
  )
  values (
    v_conversation.id, 'customer', p_content_type, p_content_text, null,
    case when p_media_pending then 'pending' else null end,
    p_message_id, 'delivered', p_created_at, v_reply_to,
    p_interactive_reply_id, p_mentions
  )
  returning id into v_message_row_id;

  -- The preview moves only when this message really is the newest, and it
  -- carries the message's OWN time. unread_count still rises either way —
  -- a message that arrives late is no less unread.
  update conversations
     set last_message_text = case
           when p_created_at >= coalesce(last_message_at, '-infinity'::timestamptz)
             then coalesce(nullif(btrim(p_content_text), ''), '[' || coalesce(p_content_type, 'message') || ']')
           else last_message_text
         end,
         last_message_at = greatest(
           coalesce(last_message_at, '-infinity'::timestamptz),
           p_created_at
         ),
         unread_count = coalesce(unread_count, 0) + 1,
         updated_at = now()
   where id = v_conversation.id;

  return jsonb_build_object(
    'deduped', false,
    'contact_id', v_contact.id,
    'contact_created', v_contact_created,
    'contact_avatar_url', v_prior_avatar,
    'contact_was_on_whatsapp', v_was_on_whatsapp,
    'conversation_id', v_conversation.id,
    'conversation_created', v_conv_created,
    'message_row_id', v_message_row_id,
    'is_first_inbound', v_is_first_inbound
  );
end;
$$;

revoke all on function public.whatsapp_ingest_inbound(
  uuid, uuid, uuid, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, text, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.whatsapp_ingest_inbound(
  uuid, uuid, uuid, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, text, boolean, boolean
) to service_role;

commit;
