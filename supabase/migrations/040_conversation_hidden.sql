-- ============================================================
-- 040_conversation_hidden
--
-- Hide a conversation from the CRM inbox entirely. Unlike Archive (which
-- mirrors to WhatsApp and stays a browsable folder), Hide is CRM-local:
-- hidden conversations are excluded from ALL normal inbox views (All /
-- Individuals / Groups + every status filter) so non-business chats you
-- only handle inside WhatsApp itself don't clutter the CRM. They're
-- surfaced only via the "Hidden" filter, where they can be unhidden.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_hidden
  ON conversations (account_id, hidden_at)
  WHERE hidden_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
