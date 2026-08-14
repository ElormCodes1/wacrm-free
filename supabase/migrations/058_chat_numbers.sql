-- ============================================================
-- 058_chat_numbers.sql — which of our numbers can see which chat
--
-- An account can link several WhatsApp numbers, and a chat belongs to
-- whichever of them is actually in it. 035 records that as a single
-- `conversations.whatsapp_config_id`, re-tagged on every inbound message
-- — last-writer-wins. That is fine for a 1:1 chat, which only ever
-- reaches one line, but wrong for groups: if two of our numbers are in
-- the same group the tag flips back and forth, and if neither has
-- received anything yet the tag is NULL and a reply has to guess.
--
-- The relationship is genuinely many-to-many, so model it that way. Every
-- inbound event already names both halves — the instance it arrived on
-- and the chat it belongs to — so the map fills itself in as traffic
-- flows, and needs no separate sync.
--
-- What this buys, beyond correct reply routing:
--   * "this chat is on Elorm MTN, and that line is disconnected" — the
--     silent failure that made messages appear to vanish, with the answer
--     sitting in data nobody was joining up.
--   * a real membership list for a group, rather than a guess from
--     whoever happened to message last.
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The number that can see this chat.
  whatsapp_config_id UUID NOT NULL REFERENCES whatsapp_config(id) ON DELETE CASCADE,
  -- WhatsApp's own address for the chat: `<phone>@s.whatsapp.net` or
  -- `<id>@g.us`. Deliberately the JID rather than our contact id — the
  -- map is populated from webhook events, which arrive before (and
  -- sometimes without) a contact row.
  remote_jid TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (number, chat). Plain unique index, not partial: ON CONFLICT
-- can't infer a partial one through PostgREST — the 42P10 trap from 054.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_numbers_pair
  ON chat_numbers (whatsapp_config_id, remote_jid);

-- "Which numbers can see this chat?" — the lookup the inbox makes.
CREATE INDEX IF NOT EXISTS idx_chat_numbers_lookup
  ON chat_numbers (account_id, remote_jid);

ALTER TABLE chat_numbers ENABLE ROW LEVEL SECURITY;

-- Readable by members of the owning account; only the service role (the
-- webhook) writes, so there is no insert/update policy.
DROP POLICY IF EXISTS "Members can view their chat numbers" ON chat_numbers;
CREATE POLICY "Members can view their chat numbers" ON chat_numbers
  FOR SELECT
  USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
