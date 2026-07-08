-- ============================================================
-- 048_message_pin.sql — pinned messages (WhatsApp pin-in-chat)
--
-- Pin an important message in a conversation (an order confirmation, an
-- address, a meeting link) — mirrored to WhatsApp so the contact sees it
-- pinned too. `pinned_until` holds the pin's expiry (WhatsApp pins are
-- time-boxed: 24h / 7d / 30d); NULL means not pinned. The thread shows a
-- 📌 indicator on pinned messages whose expiry is still in the future.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS pinned_until TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
