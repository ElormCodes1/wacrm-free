-- ============================================================
-- 060_global_search.sql — indexes for search across the CRM
--
-- "Find that chat about the invoice" had no answer: the inbox filters by
-- conversation, and nothing searched message bodies at all.
--
-- Trigram indexes rather than tsvector/full-text. Full-text stems and
-- tokenises for a known language, which fits prose in one language and
-- fits this content badly: WhatsApp messages here mix English and Twi,
-- carry names, phone numbers, order references and emoji, and people
-- search them by fragment — "invoi", "0244", "GH-21". `ILIKE '%frag%'`
-- answers that directly, and pg_trgm makes it indexable instead of a
-- sequential scan.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Message bodies — the search that was missing entirely.
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON messages USING GIN (content_text gin_trgm_ops);

-- Contacts by name. Phone is matched with a plain suffix/prefix ILIKE,
-- which the existing btree already serves.
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON contacts USING GIN (name gin_trgm_ops);

-- Ordering search hits by recency, and scoping them to an account, both
-- happen on every query.
CREATE INDEX IF NOT EXISTS idx_messages_created_at_desc
  ON messages (created_at DESC);

NOTIFY pgrst, 'reload schema';
