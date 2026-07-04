-- ============================================================
-- Group chat support.
--
-- A WhatsApp group is modelled as a contact with is_group = true (phone
-- holds the group id). This reuses the whole contact→conversation→message
-- pipeline unchanged; groups just appear as conversations in the inbox.
--
--   * contacts.is_group        — marks a contact row as a group.
--   * messages.author_name     — the group member who sent an inbound
--   * messages.author_phone      message (null for 1:1 chats).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS author_name TEXT,
  ADD COLUMN IF NOT EXISTS author_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_is_group
  ON contacts (account_id, is_group);
