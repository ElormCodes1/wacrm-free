-- ============================================================
-- 076_customer_plan_view.sql — a customer can see their own plan
--
-- Until now billing was operator-only: RLS on, no policy, invisible to
-- the customer API entirely. That was right while the limits were purely
-- advisory notes for us. It stops being right the moment we want to tell
-- a customer they have outgrown their tier — you cannot prompt somebody
-- to upgrade from something they cannot see.
--
-- Exposed through a function rather than by loosening the tables, and
-- scoped to auth.uid() INSIDE the function rather than taking an account
-- id from the caller. That is the difference between "show me my plan"
-- and "show me any plan": a parameter would be attacker-controlled, and
-- the whole tenancy design rests on the company for a request never
-- coming from something the browser supplies.
--
-- It returns usage as well as ceilings, because a prompt that says "you
-- are over your limit" without saying by how much invites a support
-- message asking exactly that.
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_plan_usage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_account UUID;
  v_result  JSONB;
BEGIN
  -- The account comes from the session, never from an argument.
  SELECT p.account_id INTO v_account
  FROM profiles p
  WHERE p.user_id = auth.uid() AND p.is_active
  LIMIT 1;

  IF v_account IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'plan_name',    pl.name,
    'plan_id',      pl.id,
    'interval',     pl.interval,
    'amount_minor', COALESCE(ab.amount_minor, pl.amount_minor),
    'currency',     COALESCE(ab.currency, pl.currency),
    'state',        public.billing_state(ab.status, ab.trial_ends_at, ab.period_end),
    'period_end',   ab.period_end,

    'max_numbers',  pl.max_numbers,
    'max_members',  pl.max_members,
    'max_storage_mb', pl.max_storage_mb,
    'max_broadcast_sends_30d', pl.max_broadcast_sends_30d,
    'allow_api',    COALESCE(pl.allow_api, TRUE),

    'numbers', (SELECT count(*) FROM whatsapp_config w WHERE w.account_id = v_account),
    'members', (SELECT count(*) FROM profiles p2 WHERE p2.account_id = v_account),
    'storage_bytes', (
      SELECT coalesce(sum((o.metadata->>'size')::BIGINT), 0)
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN storage.objects o
        ON o.bucket_id = 'chat-media'
       AND o.name = split_part(m.media_url, '/chat-media/', 2)
      WHERE c.account_id = v_account AND m.media_url IS NOT NULL
    ),
    'broadcast_sends_30d', (
      SELECT coalesce(sum(coalesce(b.sent_count, 0)), 0)
      FROM broadcasts b
      WHERE b.account_id = v_account AND b.created_at > now() - interval '30 days'
    )
  )
  INTO v_result
  FROM accounts a
  LEFT JOIN account_billing ab ON ab.account_id = a.id
  LEFT JOIN billing_plans   pl ON pl.id = ab.plan_id
  WHERE a.id = v_account;

  RETURN v_result;
END;
$$;

-- Callable by a signed-in customer. anon gets nothing: auth.uid() is null
-- for them, so the function returns NULL rather than leaking a default.
REVOKE ALL ON FUNCTION public.my_plan_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_plan_usage() TO authenticated;

-- ---------- asking to move up ----------
--
-- There is no payment processor, so "Upgrade" cannot charge a card. What
-- it can do is tell us, which is the honest version of the button: the
-- customer records the intent, the operator sees it in the console and
-- moves them across. Anything else would be a button that appears to do
-- something and does not.

CREATE TABLE IF NOT EXISTS upgrade_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_plan_id UUID REFERENCES billing_plans(id) ON DELETE SET NULL,
  -- What made them ask. Recorded so the operator opens the conversation
  -- knowing whether it was numbers, storage or the API.
  reason       TEXT,
  note         TEXT,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_name TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_open
  ON upgrade_requests (account_id, created_at DESC) WHERE status = 'open';

-- One open request per company. A customer clicking twice should not
-- produce two rows for the operator to work through.
CREATE UNIQUE INDEX IF NOT EXISTS idx_upgrade_requests_one_open
  ON upgrade_requests (account_id) WHERE status = 'open';

ALTER TABLE upgrade_requests ENABLE ROW LEVEL SECURITY;

-- Members may raise one and see their own company's. They may not edit or
-- withdraw it: resolving is the operator's side of the conversation.
DROP POLICY IF EXISTS upgrade_requests_insert ON upgrade_requests;
CREATE POLICY upgrade_requests_insert ON upgrade_requests
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS upgrade_requests_select ON upgrade_requests;
CREATE POLICY upgrade_requests_select ON upgrade_requests
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

NOTIFY pgrst, 'reload schema';
