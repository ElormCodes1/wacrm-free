-- ============================================================
-- 047_message_event_type.sql — allow 'event' messages
--
-- WhatsApp calendar/event messages (native RSVP invites) — e.g. a CRM
-- agent scheduling an onboarding call with a contact. Stored like any
-- other message; content_text holds a human-readable summary the thread
-- renders as an event card.
-- ============================================================

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'contact', 'poll', 'call', 'event'
  ));

NOTIFY pgrst, 'reload schema';
