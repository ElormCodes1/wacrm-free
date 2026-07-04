-- ============================================================
-- whatsapp_config: switch from Meta Cloud API to self-hosted
-- Evolution API (Baileys).
--
-- Why this exists:
--   wacrm-free replaces Meta's Cloud API with a self-hosted
--   Evolution API server. A WhatsApp connection there is an
--   "instance" (one instance == one linked number), authenticated
--   by scanning a QR code — NOT by a phone_number_id + access_token
--   pair. This migration adds the instance columns and relaxes the
--   Meta-only NOT NULL constraints so a row can be saved before (or
--   without ever) having any Meta credentials.
--
-- What changes:
--   + instance_name      the Evolution instance this account owns
--   + instance_id        Evolution's internal UUID for the instance
--   + connection_state   live Baileys state: open | connecting | close
--   ~ phone_number_id    now nullable (Meta-only; unused by Evolution)
--   ~ access_token       now nullable (Meta-only; unused by Evolution)
--
-- The legacy Meta columns (waba_id, verify_token, registered_at,
-- subscribed_apps_at, last_registration_error, phone_number_id,
-- access_token) are intentionally LEFT IN PLACE, just made optional.
-- Keeping them avoids a destructive drop while the Meta code paths are
-- being retired phase-by-phase; a later migration can remove them once
-- nothing reads them.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS instance_name    TEXT,
  ADD COLUMN IF NOT EXISTS instance_id      TEXT,
  ADD COLUMN IF NOT EXISTS connection_state TEXT NOT NULL DEFAULT 'close'
    CHECK (connection_state IN ('open', 'connecting', 'close'));

-- Meta credentials are no longer required to create a config row.
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token    DROP NOT NULL;

-- One Evolution instance per name, globally. Partial unique index so
-- multiple legacy rows with a NULL instance_name don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_instance_name
  ON whatsapp_config (instance_name)
  WHERE instance_name IS NOT NULL;

-- The webhook will resolve the owning account by instance_name (the way
-- it used to resolve by phone_number_id), so index it for that lookup.
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_instance_lookup
  ON whatsapp_config (instance_name)
  WHERE instance_name IS NOT NULL;
