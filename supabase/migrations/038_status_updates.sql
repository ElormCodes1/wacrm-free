-- ============================================================
-- 038_status_updates
--
-- WhatsApp Status (Stories) — the VIEWING side. Posting already
-- exists (sendStatus + /api/whatsapp/status). Incoming statuses
-- arrive as MESSAGES_UPSERT events with remoteJid='status@broadcast'
-- (previously the webhook skipped them). This table stores both
-- contacts' statuses (is_mine=false, attributed to a contact) and our
-- own posts (is_mine=true, contact_id NULL), each expiring after 24h.
-- ============================================================

CREATE TABLE IF NOT EXISTS status_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The number that received (or posted) this status.
  whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  -- Poster. For our own posts contact_id is NULL and is_mine=true.
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  is_mine BOOLEAN NOT NULL DEFAULT false,
  poster_phone TEXT,
  poster_name TEXT,
  content_type TEXT NOT NULL DEFAULT 'text'
    CHECK (content_type IN ('text', 'image', 'video', 'audio')),
  content_text TEXT,               -- caption (media) or body (text status)
  media_url TEXT,                  -- stored to the chat-media bucket
  background_color TEXT,           -- text statuses only (#RRGGBB)
  message_id TEXT NOT NULL,        -- Baileys key.id — dedup + mark-read
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL, -- posted_at + 24h
  viewed_at TIMESTAMPTZ,           -- when an agent viewed it (NULL = unseen)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per status. Lets the webhook echo of our own post and the
  -- POST route's immediate insert converge (upsert on conflict).
  UNIQUE (account_id, message_id)
);

-- Feed query: active (non-expired) statuses for an account, newest first.
CREATE INDEX IF NOT EXISTS idx_status_updates_account_active
  ON status_updates (account_id, expires_at, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_updates_contact
  ON status_updates (contact_id);

ALTER TABLE status_updates ENABLE ROW LEVEL SECURITY;

-- Members read their account's statuses. Writes happen only through the
-- webhook / API routes on the service role (which bypasses RLS), mirroring
-- the notifications table — so no client INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS status_updates_select ON status_updates;
CREATE POLICY status_updates_select ON status_updates FOR SELECT
  USING (is_account_member(account_id));

-- PostgREST schema-cache reload so the new table/columns are visible
-- immediately (same pattern as 032/033/037).
NOTIFY pgrst, 'reload schema';
