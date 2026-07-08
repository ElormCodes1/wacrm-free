-- ============================================================
-- 043_message_starred
--
-- Star (bookmark) a message so it's easy to find later — a customer's
-- address, an agreed price, a complaint. CRM-local; surfaced in-thread with
-- a star icon and collected in the contact sidebar's "Starred" section.
-- starred_at NULL = not starred.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS starred_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_starred
  ON messages (conversation_id, starred_at DESC)
  WHERE starred_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
