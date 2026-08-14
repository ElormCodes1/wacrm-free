-- ============================================================
-- 053_message_media_status.sql — inbound media arrives after the bubble
--
-- Inbound media used to block the message INSERT: the webhook downloaded
-- the file from Evolution and uploaded it to storage *before* writing the
-- row, so a video could keep the whole message invisible for tens of
-- seconds. The row is now inserted immediately and the media backfilled
-- by a follow-up UPDATE (which Realtime pushes to the open thread).
--
-- That split needs a third state in the UI. `media_url IS NULL` alone is
-- ambiguous — it means both "still uploading" and "download failed" — and
-- rendering "Image unavailable" for a file that is merely in flight is
-- worse than the delay it replaces. So:
--
--   'pending' — fetch in flight; show a placeholder, expect an UPDATE
--   'ready'   — media_url is populated and usable
--   'failed'  — fetch or upload gave up; show "unavailable"
--   NULL      — not a media message, or a row from before this migration
--
-- NULL is deliberately the default so existing rows keep rendering off
-- media_url exactly as they do today.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_status TEXT
    CHECK (media_status IN ('pending', 'ready', 'failed'));

-- Sweeping up stuck 'pending' rows (process died mid-upload) means finding
-- them by status + age; the partial index keeps that cheap and tiny.
CREATE INDEX IF NOT EXISTS idx_messages_media_pending
  ON messages (created_at)
  WHERE media_status = 'pending';

NOTIFY pgrst, 'reload schema';
