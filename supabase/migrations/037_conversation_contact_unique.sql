-- ============================================================
-- 037_conversation_contact_unique
--
-- Prevent the same contact from fragmenting into multiple
-- conversations within one account.
--
-- `conversations` never had a uniqueness guarantee — only plain
-- indexes on (contact_id) / (account_id). The app relied entirely
-- on findOrCreateConversation's read-then-write to de-dupe. That
-- held under the old Meta webhook (a burst of messages arrived as
-- ONE POST, processed serially), but the Evolution/Baileys port
-- delivers each inbound message as its OWN webhook POST. A burst of
-- messages fires concurrent after() callbacks that each SELECT
-- (finding nothing yet) and INSERT — spawning one conversation per
-- message. Worse, the old `.single()` lookup then ERRORED on the 2+
-- resulting rows, so every later message created yet another
-- conversation (runaway duplication — see the inbox filling with
-- one-message "chats" for a single contact).
--
-- This migration, mirroring 022_contact_phone_dedup:
--   1. merges existing duplicate conversations into the oldest row,
--      re-pointing all child records first so nothing is lost;
--   2. adds a UNIQUE index on (account_id, contact_id) — the
--      authoritative guard that covers every write path.
--
-- The app-side fix (findOrCreateConversation now collapses onto the
-- oldest row + re-selects on unique violation) is the fast path;
-- this index is the backstop that makes the race impossible.
--
-- Idempotent. **No data loss** — duplicate conversations are merged,
-- not dropped: their messages, reactions, deals, flow_runs, and
-- notifications are re-pointed to the surviving (oldest) conversation
-- before the losers are deleted.
-- ============================================================

-- One-time (re-runnable) merge of existing duplicates. SECURITY
-- DEFINER so it can re-point rows across tables regardless of the
-- caller's RLS; it only ever collapses conversations that share the
-- same (account_id, contact_id).
CREATE OR REPLACE FUNCTION public.merge_duplicate_conversations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group    RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           contact_id,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM conversations
    GROUP BY account_id, contact_id
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    -- Re-point every child of the losers onto the survivor. None of
    -- these tables carry a conversation-scoped unique constraint, so
    -- a plain UPDATE is safe:
    --   messages / message_reactions   ON DELETE CASCADE — re-point
    --     is what rescues them from deletion with the loser.
    --   deals                          plain FK (RESTRICT) — a loser
    --     with a deal would otherwise block the DELETE below.
    --   flow_runs / notifications      ON DELETE SET NULL / CASCADE —
    --     re-pointed to keep the audit/timeline trail intact.
    -- (flow_runs' partial UNIQUE is on contact_id, not
    --  conversation_id, so re-pointing conversation_id can't collide.)
    UPDATE messages          SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE message_reactions SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE deals             SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE flow_runs         SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE notifications     SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);

    -- Fold the losers' counters into the survivor before deleting them.
    UPDATE conversations s SET
      unread_count   = COALESCE((
        SELECT sum(COALESCE(c.unread_count, 0))
        FROM conversations c
        WHERE c.id = ANY(v_group.ids)
      ), 0),
      ai_reply_count = COALESCE((
        SELECT max(COALESCE(c.ai_reply_count, 0))
        FROM conversations c
        WHERE c.id = ANY(v_group.ids)
      ), 0)
    WHERE s.id = v_survivor;

    -- Point last_message_* at the most recent surviving message.
    UPDATE conversations s SET
      last_message_text = m.content_text,
      last_message_at   = m.created_at
    FROM (
      SELECT content_text, created_at
      FROM messages
      WHERE conversation_id = v_survivor
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) m
    WHERE s.id = v_survivor;

    DELETE FROM conversations WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;

ALTER FUNCTION public.merge_duplicate_conversations() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC;

-- Collapse whatever duplicates exist right now.
SELECT public.merge_duplicate_conversations();

-- Authoritative guarantee — one conversation per contact per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON conversations (account_id, contact_id);

-- PostgREST needs a schema-cache reload to notice the new index for
-- on-conflict handling (matches the pattern used by 032/033).
NOTIFY pgrst, 'reload schema';
