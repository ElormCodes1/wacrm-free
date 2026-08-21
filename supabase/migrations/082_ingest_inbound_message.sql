-- ============================================================
-- 082_ingest_inbound_message.sql — store an inbound message in one round trip
--
-- Storing one WhatsApp message costs five separate calls to this database:
-- record the chat number, find-or-create the contact, find-or-create the
-- conversation, insert the message (alongside a prior-inbound check), then
-- bump the conversation's counters. Supabase is remote, so each is real
-- network latency, and the measured cost per message was 1.2–4.2s against
-- a per-event budget the whole platform shares.
--
-- That is the ceiling on how many tenants this can serve. Fair queueing
-- decides who waits; it cannot make the work cheaper. This can: the same
-- five steps, one round trip, one transaction.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
-- No business logic. Flows, automations, avatar and profile enrichment,
-- broadcast-reply flagging and outbound webhooks all stay in the
-- application. This function is the STORAGE step and nothing else — so
-- the behaviour that is hard to reason about stays where it can be read,
-- tested and changed without a migration.
--
-- It returns the facts the caller needs to carry on making those
-- decisions: whether the contact and conversation were created, what the
-- contact's avatar was BEFORE this ran, and whether this is the first
-- inbound message of the thread.
--
-- ATOMICITY IS A BONUS, NOT THE POINT
--
-- The application version does find→insert with a retry loop, because
-- Evolution delivers each message as its own POST and a new contact's
-- first burst runs it concurrently N times. Inside one transaction the
-- same races are handled by the unique indexes directly, and the
-- unread_count bump becomes `unread_count + 1` in the database rather
-- than a read-modify-write that can lose increments under exactly the
-- burst it is there to count.
-- ============================================================

begin;

create or replace function public.whatsapp_ingest_inbound(
  p_account_id          uuid,
  p_user_id             uuid,
  p_whatsapp_config_id  uuid,
  -- Kept for signature stability and future use; chat_numbers is
  -- recorded by the caller, see below.
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
  -- Backlog replay may already hold this message. Checked FIRST and by
  -- message_id alone, matching the application path exactly — a
  -- conversation-scoped check would be tighter but is a behaviour change,
  -- and this migration is not the place to make one.
  if p_is_history and exists (
    select 1 from messages where message_id = p_message_id limit 1
  ) then
    return jsonb_build_object('deduped', true);
  end if;

  -- chat_numbers is deliberately NOT written here. recordChatNumber
  -- already runs earlier for every inbound event — group and status
  -- included — so doing it again would be a second write of the same row
  -- for the one path that reaches this function.

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
      -- Lost the race. The winner is authoritative; never drop the message.
      select * into v_contact
      from contacts
      where account_id = p_account_id and phone_normalized = regexp_replace(p_phone, '\D', '', 'g')
      limit 1;
    end;
  end if;

  if v_contact.id is null then
    -- Could not resolve a contact at all. Report it rather than inserting
    -- a message that would hang off nothing.
    return jsonb_build_object('error', 'contact-unresolved');
  end if;

  -- Reported as they were BEFORE this call, because the caller uses them
  -- to decide whether to fetch an avatar or profile — and the update
  -- below would otherwise erase the very signal it is checking.
  v_prior_avatar := v_contact.avatar_url;
  -- For a contact created a moment ago the "prior" state is that we had
  -- never heard of them — not the true this call just wrote. Reporting
  -- the value we set would be a fact about our own write, dressed up as a
  -- fact about the contact.
  v_was_on_whatsapp := case when v_contact_created then null
                            else v_contact.is_on_whatsapp end;

  -- They just messaged us, so they are demonstrably on WhatsApp. Only
  -- written when it would change something.
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
    -- Re-tag: this thread was last seen on a different one of our numbers.
    update conversations set whatsapp_config_id = p_whatsapp_config_id
     where id = v_conversation.id;
    v_conversation.whatsapp_config_id := p_whatsapp_config_id;
  end if;

  if v_conversation.id is null then
    return jsonb_build_object('error', 'conversation-unresolved');
  end if;

  -- Reactions resolve a conversation but store no message.
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

  -- Meta ids are not unique across numbers (see migration 009), so a
  -- reply parent is resolved within this conversation only.
  if p_reply_to_meta_id is not null then
    select id into v_reply_to
    from messages
    where conversation_id = v_conversation.id and message_id = p_reply_to_meta_id
    limit 1;
  end if;

  -- "Has this contact ever written before?" — an existence check, and one
  -- that must exclude THIS message so the answer does not depend on
  -- whether it runs before or after the insert below.
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

  -- `unread_count + 1` in the database, not read-modify-write in the
  -- application: a burst of messages arriving together is exactly the case
  -- the counter exists for, and exactly the case that loses increments.
  update conversations
     set last_message_text = coalesce(nullif(p_content_text, ''), '[' || p_content_type || ']'),
         last_message_at   = now(),
         unread_count      = coalesce(unread_count, 0) + 1,
         updated_at        = now()
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

-- Only the service role. The webhook is the sole caller and runs with it;
-- this function bypasses RLS by design, so nobody holding an anon or
-- authenticated token may reach it.
revoke all on function public.whatsapp_ingest_inbound(
  uuid, uuid, uuid, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, text, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.whatsapp_ingest_inbound(
  uuid, uuid, uuid, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, text, boolean, boolean
) to service_role;

commit;
