-- ============================================================
-- contacts: cache whether the number is registered on WhatsApp.
--
-- Populated from three sources:
--   * inbound messages  → definitely on WhatsApp (set true)
--   * the pre-first-send number check (send / broadcast) → true/false
--
-- NULL means "not yet checked / unknown" — the UI shows no badge (or a
-- subtle unverified state) rather than claiming either way. whatsapp_
-- checked_at records when the flag was last set so a future job could
-- re-verify stale entries.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_on_whatsapp      BOOLEAN,
  ADD COLUMN IF NOT EXISTS whatsapp_checked_at TIMESTAMPTZ;

-- Backfill: any contact who has ever sent us a message is, by
-- definition, on WhatsApp. Marks them so the badge is populated for
-- existing conversations without waiting for a fresh inbound.
UPDATE contacts c
SET is_on_whatsapp = true,
    whatsapp_checked_at = NOW()
WHERE c.is_on_whatsapp IS NULL
  AND EXISTS (
    SELECT 1
    FROM messages m
    JOIN conversations cv ON cv.id = m.conversation_id
    WHERE cv.contact_id = c.id
      AND m.sender_type = 'customer'
  );
