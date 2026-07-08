-- ============================================================
-- 050_perf_indexes.sql — indexes for the queries that grow
--
-- From the performance audit. The dataset is small today, so these are
-- forward-looking: they keep the hot/growing query paths fast as messages
-- and conversations scale into the thousands. Zero behaviour change.
-- ============================================================

-- Message thread loads by conversation ordered by time; the dashboard
-- response-time pairing orders (conversation_id, created_at). A composite
-- serves both AND fully covers the old conversation_id-only lookups, so we
-- replace the single-column index (one less index to maintain on the
-- highest-insert table — the webhook writes one row per inbound message).
DROP INDEX IF EXISTS idx_messages_conversation;
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at);

-- Dashboard aggregations (messages-per-day series, messages-sent metric)
-- scan messages by a created_at time window.
CREATE INDEX IF NOT EXISTS idx_messages_created_at
  ON messages (created_at);

-- Inbox conversation list orders by last_message_at within an account.
CREATE INDEX IF NOT EXISTS idx_conversations_account_last_message
  ON conversations (account_id, last_message_at DESC);

-- The app-wide total-unread badge counts conversations with unread > 0.
CREATE INDEX IF NOT EXISTS idx_conversations_unread
  ON conversations (account_id)
  WHERE unread_count > 0;
