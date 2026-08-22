-- ============================================================
-- 085_messages_account_id.sql — let realtime filter messages by tenant
--
-- Every open tab subscribes to ALL message changes and lets row-level
-- security sort out which ones it may see. That means Realtime evaluates
-- policies per subscriber, per row: with T tenants each having a couple
-- of tabs open, one inbound message costs on the order of T × tabs policy
-- evaluations. The cost grows with how many CUSTOMERS are signed in, not
-- with how busy any of them are, so the quietest tenant on the platform
-- pays for everyone else being online.
--
-- A subscription filter fixes that — Realtime discards non-matching rows
-- before the per-subscriber work — but `postgres_changes` can only filter
-- on a column of the table it is watching, and messages has no tenant
-- column. It reaches its account through conversation_id, which a filter
-- cannot follow.
--
-- Hence this column. It is denormalised on purpose: the conversation
-- remains the source of truth for which account a message belongs to, and
-- this is a copy kept for routing.
--
-- Written by a TRIGGER, not by the insert sites. There are several of
-- them today — the 1:1 path, the group path, status, outbound sends, the
-- ingest function from migration 082 — and the next one somebody adds
-- would silently produce rows that no subscriber receives. A message that
-- exists but never reaches the inbox is the worst failure this system
-- has, and it must not be reintroduced by an easy omission.
-- ============================================================

begin;

alter table public.messages
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;

comment on column public.messages.account_id is
  'Denormalised from the parent conversation so realtime subscriptions can '
  'filter by tenant — postgres_changes cannot follow conversation_id. '
  'Maintained by the messages_set_account_id trigger; do not set it by hand.';

create or replace function public.messages_set_account_id()
returns trigger
language plpgsql
as $$
begin
  -- Only when the caller has not supplied one, so an explicit value (a
  -- backfill, a data repair) is respected rather than overwritten.
  if new.account_id is null and new.conversation_id is not null then
    select c.account_id into new.account_id
    from public.conversations c
    where c.id = new.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_set_account_id on public.messages;

create trigger messages_set_account_id
  before insert on public.messages
  for each row
  execute function public.messages_set_account_id();

-- Backfill in batches rather than one statement. A single UPDATE over the
-- whole table takes a long lock and writes every row at once; inbound
-- messages are arriving while this runs.
do $$
declare
  touched integer;
begin
  loop
    with batch as (
      select m.id, c.account_id
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.account_id is null
      limit 5000
    )
    update public.messages m
       set account_id = batch.account_id
      from batch
     where m.id = batch.id;

    get diagnostics touched = row_count;
    exit when touched = 0;
  end loop;
end;
$$;

-- The realtime filter is an equality on account_id; the inbox also reads
-- a tenant's recent messages directly.
create index if not exists messages_account_id_created_at_idx
  on public.messages (account_id, created_at desc);

commit;
