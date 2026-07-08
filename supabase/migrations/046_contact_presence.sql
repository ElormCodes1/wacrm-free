-- ============================================================
-- 046_contact_presence.sql — WhatsApp contact presence
--
-- Live "online" / "typing…" / "last seen" for the person on the other
-- end of a conversation, so agents see the same presence WhatsApp shows
-- them — one less reason to leave the CRM for the phone.
--
-- Design
--
--   Evolution already forwards Baileys' `presence.update` over the
--   webhook (it auto-subscribes to a contact's presence whenever they
--   message us) — this is a pure WIRE, no patched image needed. The
--   webhook upserts one row per contact here; the inbox subscribes via
--   Realtime and renders the state under the contact's name.
--
--   Distinct from `member_presence` (024), which tracks CRM *teammates*
--   using the dashboard. This tracks the WhatsApp *contact*.
--
--   State is Baileys' `lastKnownPresence`:
--     available    → online
--     unavailable  → offline (with `last_seen` when the contact shares it)
--     composing    → typing…
--     recording    → recording a voice note…
--     paused       → stopped typing (back to online/last-seen)
--
--   Typing states are transient — the client treats a stale
--   composing/recording row as "not typing" so a dropped `paused`/
--   `available` follow-up can't pin the indicator on forever.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_presence (
  contact_id  UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  state       TEXT NOT NULL CHECK (state IN ('available', 'unavailable', 'composing', 'recording', 'paused')),
  -- Unix-seconds → timestamp of the contact's last seen, when they
  -- share it (privacy settings may withhold it → NULL).
  last_seen   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_presence_account_idx
  ON contact_presence(account_id);

-- ---- RLS ---------------------------------------------------
ALTER TABLE contact_presence ENABLE ROW LEVEL SECURITY;

-- Account members may read presence for their account's contacts.
-- All writes flow through the webhook (service role, bypasses RLS) —
-- no client write policy exists.
DROP POLICY IF EXISTS contact_presence_select ON contact_presence;
CREATE POLICY contact_presence_select ON contact_presence FOR SELECT
  USING (is_account_member(account_id));

-- ---- realtime ----------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contact_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_presence;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
