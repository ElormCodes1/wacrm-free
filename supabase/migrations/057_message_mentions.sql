-- ============================================================
-- 057_message_mentions.sql — resolved @mentions per message
--
-- A WhatsApp mention is split across two places: the text carries a bare
-- `@<digits>` token, and `contextInfo.mentionedJid` carries the JIDs. The
-- digits are the JID's local part — and these days that is a LID, so an
-- unresolved mention reads as `@48688487493799` in the thread, which tells
-- the reader nothing and can't be clicked anywhere.
--
-- Joining the two needs a per-message record, because the same token means
-- different things in different accounts and the LID → phone binding is
-- learned over time. Shape:
--
--   [{ "token": "48688487493799",         -- what appears in the text
--      "jid":   "48688487493799@lid",     -- what contextInfo carried
--      "phone": "233241035885" | null }]  -- resolved, null if not yet known
--
-- `phone` is deliberately nullable rather than the row being dropped: an
-- unresolved mention still renders as a mention (a person we can't name
-- yet) instead of silently degrading to digits, and keeping the jid means
-- it can be resolved later without re-reading the WhatsApp payload.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mentions JSONB;

-- Finding "messages that mention this person" is the query this exists to
-- serve; a GIN index keeps the containment lookup cheap. Partial, because
-- the overwhelming majority of messages mention nobody.
CREATE INDEX IF NOT EXISTS idx_messages_mentions
  ON messages USING GIN (mentions)
  WHERE mentions IS NOT NULL;

NOTIFY pgrst, 'reload schema';
