-- ============================================================
-- 079_message_ingest_lag.sql — record when WE wrote the row
--
-- "The messages don't sync fast" could not be answered, because nothing
-- in the database recorded when a message arrived. `created_at` is
-- WhatsApp's own `messageTimestamp` — the moment the SENDER pressed send,
-- copied off the wire, in whole seconds. It says nothing about how long
-- the gateway held the event or how long this app took to store it, and
-- it moves backwards on a reconnect when WhatsApp replays a backlog.
--
-- So the one number that matters — how far behind live the inbox runs —
-- was unmeasurable, and any answer about sync speed would have been a
-- guess dressed up as a diagnosis.
--
-- `ingested_at` defaults to now() at INSERT, so:
--
--   ingested_at - created_at   = end-to-end lag (send → stored)
--
-- No backfill. Existing rows get the default at migration time, which
-- would read as "every historical message was instant" — a fabricated
-- number is worse than an absent one, so old rows stay NULL and are
-- simply excluded from any lag query.
-- ============================================================
-- Wrapped in a transaction. Postgres DDL is transactional, so if any
-- statement below fails the whole migration rolls back and the schema is
-- exactly as it was — no half-applied state to reason about at 2am.

begin;

alter table public.messages
  add column if not exists ingested_at timestamptz;

-- New rows only. The default applies from here on; rows written before
-- this migration keep NULL, which is the honest value for "we did not
-- measure this one".
alter table public.messages
  alter column ingested_at set default now();

comment on column public.messages.ingested_at is
  'When this app stored the row (server clock). NULL for rows predating '
  'migration 079. Compare against created_at — which is WhatsApp''s send '
  'timestamp, not ours — to get end-to-end delivery lag.';

-- Lag queries scan recent rows and sort by arrival. Partial: the NULLs
-- are never selected, so there is no reason to carry them in the index.
create index if not exists messages_ingested_at_idx
  on public.messages (ingested_at desc)
  where ingested_at is not null;

commit;
