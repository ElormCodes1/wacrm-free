-- ============================================================
-- 054_pending_lid_events.sql — inbound messages we can't yet address
--
-- WhatsApp increasingly addresses messages by an opaque LID (`<id>@lid`)
-- instead of a phone number. The phone appears in `remoteJidAlt`, but only
-- on messages we SEND — an inbound LID message carries no phone at all,
-- and the webhook has to look the binding up. Until it does, the message
-- can't be attributed to a contact.
--
-- The old behaviour was `if (!jid) return`: the message vanished, with no
-- row, no log and no retry. This table is the alternative — park the raw
-- event, then replay it the moment the binding becomes known (the next
-- outbound message to that chat reveals it).
--
-- Rows are transient by design: a successful replay deletes its row, so a
-- healthy system keeps this table empty.
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_lid_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_name TEXT NOT NULL,
  -- The unresolved `<id>@lid` this event is waiting on.
  lid TEXT NOT NULL,
  -- The raw Baileys message payload, replayed verbatim once resolvable.
  payload JSONB NOT NULL,
  -- WhatsApp message id: lets us drop duplicates if the same event is
  -- parked twice (Evolution retries webhooks on any non-2xx). NOT NULL so
  -- the dedupe index below can be a plain UNIQUE — see the note there.
  message_id TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Replay is always "everything waiting on this lid", so that's the index.
CREATE INDEX IF NOT EXISTS idx_pending_lid_events_lookup
  ON pending_lid_events (instance_name, lid);

-- Parking the same message twice is a no-op rather than a duplicate.
--
-- Deliberately NOT a partial index. ON CONFLICT can only infer a partial
-- index if the statement repeats its predicate, which PostgREST's upsert
-- cannot express — a `WHERE message_id IS NOT NULL` variant here fails at
-- runtime with 42P10 ("no unique or exclusion constraint matching the ON
-- CONFLICT specification"), which would silently defeat the whole point of
-- this table. message_id is NOT NULL, so a plain unique index is correct.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_lid_events_message
  ON pending_lid_events (instance_name, message_id);

-- Service-role only: the webhook writes and replays these; no client ever
-- reads them. RLS on with no policy denies anon/authenticated outright.
ALTER TABLE pending_lid_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
