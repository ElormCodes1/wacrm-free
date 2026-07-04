-- ============================================================
-- Extras for archive / block / call-logging / labels / enrichment.
--
--   conversations.archived_at   local archive (hidden from active inbox)
--   contacts.blocked_at         contact blocked on WhatsApp
--   contacts.status_text        their WhatsApp "about" text
--   contacts.business_profile   fetched WhatsApp business profile (jsonb)
--   tags.whatsapp_label_id      maps a CRM tag to a WhatsApp Business label
--   messages content_type += 'call'   log incoming calls in the timeline
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS blocked_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_text      TEXT,
  ADD COLUMN IF NOT EXISTS business_profile JSONB;

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS whatsapp_label_id TEXT;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'contact', 'poll', 'call'
  ));
