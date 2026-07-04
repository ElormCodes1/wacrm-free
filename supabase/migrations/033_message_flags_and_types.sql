-- ============================================================
-- messages: support unsend / edit + richer message types.
--
--   + deleted_at   set when a message is deleted-for-everyone (unsend);
--                  the thread renders it as "This message was deleted".
--   + edited_at    set when a sent message's text is edited.
--   ~ content_type CHECK widened to allow 'contact' (vCard) and 'poll'.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'contact', 'poll'
  ));
