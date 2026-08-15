-- ============================================================
-- 075_plan_limits_more.sql — the limits that track real cost, and one gate
--
-- Three more advisory ceilings and one enforced feature. The split is not
-- arbitrary: it follows who pays.
--
--   STORAGE is your bill. Media lands in Supabase storage and never
--   leaves; one customer sending voice notes all day costs you money
--   forever while nothing looks wrong. Advisory, because deleting a
--   customer's media or refusing an inbound message is not an option —
--   the message already arrived.
--
--   BROADCAST SENDS are a risk rather than a cost. On an unofficial
--   WhatsApp connection a customer blasting thousands of messages gets
--   THEIR number banned and blames us. Counted as messages actually sent
--   rather than campaigns created, because one broadcast to 5,000 people
--   is the exposure, not the row in the table.
--
--   MEMBERS is neither, really — it is a pricing lever. Included because
--   the column already existed unused.
--
--   THE PUBLIC API is the one thing enforced, and it is enforced because
--   advisory makes no sense here: an API key works forever once issued,
--   so "we noticed you are using the API you are not paying for" is a
--   conversation you have while it keeps working. It costs nothing to
--   serve, which makes it a clean reason to move up a tier.
--
-- Storage cannot be attributed by path — objects are stored flat as
-- inbound/<messageId>.<ext>, with no account prefix — so it is attributed
-- through the messages that reference them. That is a join rather than a
-- column read, which is why it lives in a function and not in the list
-- query that runs on every page.
-- ============================================================

ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS max_storage_mb INT
    CHECK (max_storage_mb IS NULL OR max_storage_mb > 0),
  ADD COLUMN IF NOT EXISTS max_broadcast_sends_30d INT
    CHECK (max_broadcast_sends_30d IS NULL OR max_broadcast_sends_30d > 0),
  -- Enforced, not advisory. Default TRUE so applying this migration takes
  -- nothing away from anyone; tiers that should not have it are set
  -- explicitly.
  ADD COLUMN IF NOT EXISTS allow_api BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN billing_plans.max_storage_mb IS
  'Media storage the plan includes, in MB. NULL = unlimited. Advisory.';
COMMENT ON COLUMN billing_plans.max_broadcast_sends_30d IS
  'Broadcast messages actually sent per rolling 30 days. NULL = unlimited. Advisory.';
COMMENT ON COLUMN billing_plans.allow_api IS
  'Whether /api/v1 works for this plan. ENFORCED at the auth path, unlike the ceilings.';

-- ---------- usage that needs a join ----------

/**
 * Storage and broadcast volume for one company.
 *
 * Separate from operator_company_list because both are joins over large
 * tables and the list runs on every page load. Called per company, on the
 * pages that show them.
 */
CREATE OR REPLACE FUNCTION public.operator_company_usage(target UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'storage_bytes', (
      SELECT coalesce(sum((o.metadata->>'size')::BIGINT), 0)
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN storage.objects o
        ON o.bucket_id = 'chat-media'
       AND o.name = split_part(m.media_url, '/chat-media/', 2)
      WHERE c.account_id = target AND m.media_url IS NOT NULL
    ),
    -- Messages actually sent, not campaigns created: one broadcast to
    -- 5,000 people is the thing that gets a number banned.
    'broadcast_sends_30d', (
      SELECT coalesce(sum(coalesce(sent_count, 0)), 0)
      FROM broadcasts
      WHERE account_id = target AND created_at > now() - interval '30 days'
    )
  )
$$;

REVOKE ALL ON FUNCTION public.operator_company_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_company_usage(UUID) TO service_role;

/**
 * The same two figures for every company at once.
 *
 * One pass over the joins rather than one call per company, for the
 * pages that list everybody.
 */
CREATE OR REPLACE FUNCTION public.operator_usage_all()
RETURNS TABLE (account_id UUID, storage_bytes BIGINT, broadcast_sends_30d BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    a.id,
    coalesce((
      SELECT sum((o.metadata->>'size')::BIGINT)
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN storage.objects o
        ON o.bucket_id = 'chat-media'
       AND o.name = split_part(m.media_url, '/chat-media/', 2)
      WHERE c.account_id = a.id AND m.media_url IS NOT NULL
    ), 0)::BIGINT,
    coalesce((
      SELECT sum(coalesce(b.sent_count, 0))
      FROM broadcasts b
      WHERE b.account_id = a.id AND b.created_at > now() - interval '30 days'
    ), 0)::BIGINT
  FROM accounts a
$$;

REVOKE ALL ON FUNCTION public.operator_usage_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_usage_all() TO service_role;

-- ---------- does this account's plan include the API? ----------

/**
 * Answered in SQL so the auth path can ask it in the same breath as the
 * key lookup rather than making a second round trip on every request.
 *
 * A company with no plan keeps API access. Taking it away from an
 * existing customer because nobody has priced them yet would be a
 * self-inflicted outage; "not on a plan" is already reported separately.
 */
CREATE OR REPLACE FUNCTION public.account_api_allowed(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT pl.allow_api
     FROM account_billing ab
     JOIN billing_plans pl ON pl.id = ab.plan_id
     WHERE ab.account_id = target),
    TRUE
  )
$$;

REVOKE ALL ON FUNCTION public.account_api_allowed(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_api_allowed(UUID) TO service_role;

-- The company billing block republished with the new ceilings, so the
-- detail page can compare against them without a second query.
CREATE OR REPLACE FUNCTION public.operator_company_billing(target UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'billing', (
      SELECT jsonb_build_object(
        'plan_id', ab.plan_id, 'plan_name', pl.name, 'plan_interval', pl.interval,
        'status', ab.status,
        'state', public.billing_state(ab.status, ab.trial_ends_at, ab.period_end),
        'amount_minor', COALESCE(ab.amount_minor, pl.amount_minor),
        'currency', COALESCE(ab.currency, pl.currency),
        'period_start', ab.period_start, 'period_end', ab.period_end,
        'trial_ends_at', ab.trial_ends_at, 'notes', ab.notes,
        'max_numbers', pl.max_numbers, 'max_members', pl.max_members,
        'max_storage_mb', pl.max_storage_mb,
        'max_broadcast_sends_30d', pl.max_broadcast_sends_30d,
        'allow_api', pl.allow_api
      )
      FROM account_billing ab LEFT JOIN billing_plans pl ON pl.id = ab.plan_id
      WHERE ab.account_id = target
    ),
    'payments', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'amount_minor', p.amount_minor, 'currency', p.currency,
        'paid_at', p.paid_at, 'method', p.method, 'reference', p.reference,
        'note', p.note, 'recorded_by_name', p.recorded_by_name, 'provider', p.provider
      ) ORDER BY p.paid_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM billing_payments WHERE account_id = target
            ORDER BY paid_at DESC LIMIT 20) p
    ),
    'paid_total', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'currency', currency, 'amount_minor', total)), '[]'::jsonb)
      FROM (SELECT currency, sum(amount_minor)::BIGINT AS total
            FROM billing_payments WHERE account_id = target GROUP BY currency) t
    )
  )
$$;

REVOKE ALL ON FUNCTION public.operator_company_billing(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_company_billing(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
