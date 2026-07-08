-- ============================================================
-- 049_status_view_avatar.sql — richer "seen by" viewers
--
-- Status viewers are usually identified only by a WhatsApp LID (a privacy
-- id, not a phone), and most have never messaged us, so we can't map them
-- to a CRM contact. To make the "seen by" list recognizable anyway, store
-- the viewer's WhatsApp profile picture + their raw JID (so we can re-fetch
-- a name/avatar later). Names still come from a CRM contact when we have
-- one, or the viewer's WhatsApp pushName when WhatsApp exposes it.
-- ============================================================

ALTER TABLE status_views
  ADD COLUMN IF NOT EXISTS viewer_avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS viewer_jid TEXT;

NOTIFY pgrst, 'reload schema';
