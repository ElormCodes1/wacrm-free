-- ============================================================
-- 044_channels
--
-- WhatsApp Channels (newsletters) managed from the CRM. Rows are created
-- when you create a channel via the CRM (is_owner=true) or add an existing
-- one by invite link (is_owner=false). Broadcasting + management go through
-- Evolution's /newsletter/* endpoints keyed by newsletter_jid.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS channels (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  newsletter_jid     TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  invite_code        TEXT,
  is_owner           BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, newsletter_jid)
);

CREATE INDEX IF NOT EXISTS idx_channels_account ON channels (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON channels;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channels_select ON channels;
CREATE POLICY channels_select ON channels FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS channels_insert ON channels;
CREATE POLICY channels_insert ON channels FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS channels_update ON channels;
CREATE POLICY channels_update ON channels FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS channels_delete ON channels;
CREATE POLICY channels_delete ON channels FOR DELETE USING (is_account_member(account_id, 'agent'));

NOTIFY pgrst, 'reload schema';
