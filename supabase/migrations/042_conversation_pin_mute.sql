-- ============================================================
-- 042_conversation_pin_mute
--
-- Pin a conversation to the top of the inbox, and mute a conversation
-- (suppress its unread emphasis + keep it out of the unread count). Both
-- are CRM-local inbox organization — you order your work queue in the CRM
-- independently of your phone's WhatsApp. Same pattern as archive/hide.
--
--   pinned_at    — when pinned (NULL = not pinned). Pinned chats sort first,
--                  most-recently-pinned above older pins.
--   muted_until  — muted through this time (NULL or past = not muted). A
--                  far-future value = muted indefinitely.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pinned_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON conversations (account_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
