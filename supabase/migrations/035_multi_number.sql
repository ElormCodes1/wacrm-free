-- ============================================================
-- Multi-number support: an account can link several WhatsApp numbers.
--
--   * Drop UNIQUE(account_id) on whatsapp_config so an account can have
--     more than one number (one row = one number = one Evolution instance).
--   * whatsapp_config.label — a friendly name for the number ("Sales line").
--   * conversations.whatsapp_config_id — which number the conversation is
--     on. Set on inbound to the receiving number; drives which number
--     replies go out from. Backfilled to each account's existing number.
--
-- The conversation model stays one-per-contact (tagged with a number),
-- not split per-number — simplest correct behaviour for the common case
-- where a customer contacts one of your lines.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;

-- Backfill: point every existing conversation at its account's current
-- (single) number.
UPDATE conversations c
SET whatsapp_config_id = wc.id
FROM whatsapp_config wc
WHERE wc.account_id = c.account_id
  AND c.whatsapp_config_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_wa_config
  ON conversations (whatsapp_config_id);
