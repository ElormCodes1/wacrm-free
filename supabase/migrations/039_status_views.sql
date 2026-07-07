-- ============================================================
-- 039_status_views
--
-- "Seen by" for our own WhatsApp statuses. WhatsApp sends a view
-- receipt (Baileys message-receipt.update, carrying the viewer's jid)
-- when a contact views your status. Stock Evolution discarded the
-- viewer identity; our patched image forwards it as a
-- MESSAGE_RECEIPT_UPDATE webhook event, and the webhook records a row
-- here per (status, viewer).
-- ============================================================

CREATE TABLE IF NOT EXISTS status_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The viewed status (one of our own posts).
  status_update_id UUID REFERENCES status_updates(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,          -- the status's Baileys key.id
  -- The viewer. Linked to a contact when we know them; phone always set.
  viewer_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  viewer_phone TEXT NOT NULL,
  viewer_name TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per viewer per status.
  UNIQUE (account_id, message_id, viewer_phone)
);

CREATE INDEX IF NOT EXISTS idx_status_views_status
  ON status_views (status_update_id);
CREATE INDEX IF NOT EXISTS idx_status_views_account_message
  ON status_views (account_id, message_id);

ALTER TABLE status_views ENABLE ROW LEVEL SECURITY;

-- Members read their account's view receipts; writes are service-role only
-- (the webhook), mirroring status_updates.
DROP POLICY IF EXISTS status_views_select ON status_views;
CREATE POLICY status_views_select ON status_views FOR SELECT
  USING (is_account_member(account_id));

NOTIFY pgrst, 'reload schema';
