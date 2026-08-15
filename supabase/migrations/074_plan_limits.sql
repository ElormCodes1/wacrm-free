-- ============================================================
-- 074_plan_limits.sql — what a plan is supposed to include
--
-- The tiers describe limits ("one number", "up to three") and nothing
-- enforces them, which is a deliberate choice: a hard gate fires at the
-- exact moment a customer is trying to expand, and turns a sales
-- conversation into an error message. But an unenforced limit that nobody
-- can SEE is not a limit at all — it is a sentence on a web page.
--
-- So the limits become data the console can compare against. Nothing here
-- blocks anything; it exists so that a company quietly running five
-- numbers on a one-number plan shows up as something to talk to them
-- about, rather than being discovered a year later.
--
-- NULL means unlimited, not zero. That distinction is the whole reason
-- these are nullable ints rather than defaulting to some large number:
-- "unlimited" is a real answer a plan can give, and encoding it as
-- 999999 means someone eventually hits it.
--
-- Kept out of public_plans on purpose. What a plan includes is already
-- said in its description, in the words the business chose; publishing a
-- machine-readable ceiling invites a "you said three" argument about a
-- number that is currently advisory.
-- ============================================================

ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS max_numbers INT CHECK (max_numbers IS NULL OR max_numbers > 0),
  ADD COLUMN IF NOT EXISTS max_members INT CHECK (max_members IS NULL OR max_members > 0);

COMMENT ON COLUMN billing_plans.max_numbers IS
  'WhatsApp numbers the plan includes. NULL = unlimited. Advisory: surfaced in the operator console, never enforced at the point of use.';
COMMENT ON COLUMN billing_plans.max_members IS
  'Team members the plan includes. NULL = unlimited. Advisory, as above.';

-- ---------- the company table, now carrying the ceiling ----------

DROP FUNCTION IF EXISTS public.operator_company_list(TEXT);

CREATE OR REPLACE FUNCTION public.operator_company_list(search TEXT DEFAULT NULL)
RETURNS TABLE (
  id               UUID,
  slug             TEXT,
  name             TEXT,
  status           TEXT,
  created_at       TIMESTAMPTZ,
  suspended_at     TIMESTAMPTZ,
  suspended_reason TEXT,
  members          BIGINT,
  numbers          BIGINT,
  numbers_down     BIGINT,
  contacts         BIGINT,
  conversations    BIGINT,
  last_activity_at TIMESTAMPTZ,
  plan_name        TEXT,
  billing_state    TEXT,
  billing_status   TEXT,
  period_end       TIMESTAMPTZ,
  amount_minor     BIGINT,
  currency         TEXT,
  max_numbers      INT,
  max_members      INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    a.id,
    a.slug,
    a.name,
    a.status::TEXT,
    a.created_at,
    a.suspended_at,
    a.suspended_reason,
    (SELECT count(*) FROM profiles p WHERE p.account_id = a.id),
    (SELECT count(*) FROM whatsapp_config w WHERE w.account_id = a.id),
    (SELECT count(*) FROM whatsapp_config w
      WHERE w.account_id = a.id AND w.connection_state IS DISTINCT FROM 'open'),
    (SELECT count(*) FROM contacts c WHERE c.account_id = a.id),
    (SELECT count(*) FROM conversations v WHERE v.account_id = a.id),
    (SELECT max(v.last_message_at) FROM conversations v WHERE v.account_id = a.id),
    pl.name,
    public.billing_state(ab.status, ab.trial_ends_at, ab.period_end),
    ab.status,
    ab.period_end,
    COALESCE(ab.amount_minor, pl.amount_minor),
    COALESCE(ab.currency, pl.currency),
    pl.max_numbers,
    pl.max_members
  FROM accounts a
  LEFT JOIN account_billing ab ON ab.account_id = a.id
  LEFT JOIN billing_plans   pl ON pl.id = ab.plan_id
  WHERE search IS NULL
     OR btrim(search) = ''
     OR a.name ILIKE '%' || btrim(search) || '%'
     OR a.slug ILIKE '%' || btrim(search) || '%'
  ORDER BY a.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.operator_company_list(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_company_list(TEXT) TO service_role;

-- ---------- and on the company's own billing block ----------

CREATE OR REPLACE FUNCTION public.operator_company_billing(target UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'billing', (
      SELECT jsonb_build_object(
        'plan_id', ab.plan_id,
        'plan_name', pl.name,
        'plan_interval', pl.interval,
        'status', ab.status,
        'state', public.billing_state(ab.status, ab.trial_ends_at, ab.period_end),
        'amount_minor', COALESCE(ab.amount_minor, pl.amount_minor),
        'currency', COALESCE(ab.currency, pl.currency),
        'period_start', ab.period_start,
        'period_end', ab.period_end,
        'trial_ends_at', ab.trial_ends_at,
        'notes', ab.notes,
        'max_numbers', pl.max_numbers,
        'max_members', pl.max_members
      )
      FROM account_billing ab
      LEFT JOIN billing_plans pl ON pl.id = ab.plan_id
      WHERE ab.account_id = target
    ),
    'payments', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'amount_minor', p.amount_minor,
        'currency', p.currency,
        'paid_at', p.paid_at,
        'method', p.method,
        'reference', p.reference,
        'note', p.note,
        'recorded_by_name', p.recorded_by_name,
        'provider', p.provider
      ) ORDER BY p.paid_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM billing_payments
        WHERE account_id = target ORDER BY paid_at DESC LIMIT 20
      ) p
    ),
    'paid_total', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'currency', currency, 'amount_minor', total
      )), '[]'::jsonb)
      FROM (
        SELECT currency, sum(amount_minor)::BIGINT AS total
        FROM billing_payments WHERE account_id = target GROUP BY currency
      ) t
    )
  )
$$;

REVOKE ALL ON FUNCTION public.operator_company_billing(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_company_billing(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
