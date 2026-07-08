-- ============================================================
-- 045_communities
--
-- WhatsApp Communities managed from the CRM. A community groups multiple
-- WhatsApp groups under one umbrella. Rows track communities created via the
-- CRM (is_owner=true) or added by metadata. Group linking + management go
-- through Evolution's /community/* endpoints keyed by community_jid.
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS communities (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  community_jid      TEXT NOT NULL,
  subject            TEXT NOT NULL,
  description        TEXT,
  invite_code        TEXT,
  is_owner           BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, community_jid)
);

CREATE INDEX IF NOT EXISTS idx_communities_account ON communities (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON communities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON communities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE communities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS communities_select ON communities;
CREATE POLICY communities_select ON communities FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS communities_insert ON communities;
CREATE POLICY communities_insert ON communities FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS communities_update ON communities;
CREATE POLICY communities_update ON communities FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS communities_delete ON communities;
CREATE POLICY communities_delete ON communities FOR DELETE USING (is_account_member(account_id, 'agent'));

NOTIFY pgrst, 'reload schema';
