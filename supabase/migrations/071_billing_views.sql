-- ============================================================
-- 071_billing_views.sql — billing, as the console needs to read it
--
-- Three additions, all locked to service_role like 068 and 069.
--
-- The one judgement worth defending: revenue is reported PER CURRENCY and
-- never summed across them. You have companies on GHS and on USD, and a
-- single "MRR" number built by adding those together would be a
-- fabrication — there is no exchange rate in this system, and inventing
-- one to make a headline figure look tidy produces a number that is
-- confidently wrong. Two rows that are each true beat one row that is not.
-- ============================================================

-- ---------- the company table, now with billing ----------

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
  currency         TEXT
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
    -- The agreed amount wins over the plan's list price: a customer on a
    -- negotiated rate must not be reported at the rate they did not agree.
    COALESCE(ab.amount_minor, pl.amount_minor),
    COALESCE(ab.currency, pl.currency)
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

-- ---------- revenue, per currency ----------

CREATE OR REPLACE FUNCTION public.operator_billing_overview()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH live AS (
    SELECT
      COALESCE(ab.currency, pl.currency, 'USD') AS currency,
      COALESCE(ab.amount_minor, pl.amount_minor, 0) AS amount_minor,
      COALESCE(pl.interval, 'month') AS interval,
      public.billing_state(ab.status, ab.trial_ends_at, ab.period_end) AS state
    FROM accounts a
    JOIN account_billing ab ON ab.account_id = a.id
    LEFT JOIN billing_plans pl ON pl.id = ab.plan_id
    WHERE ab.status <> 'canceled'
  ),
  states AS (
    SELECT public.billing_state(ab.status, ab.trial_ends_at, ab.period_end) AS state
    FROM accounts a
    LEFT JOIN account_billing ab ON ab.account_id = a.id
  )
  SELECT jsonb_build_object(
    -- Monthly recurring, normalised: a yearly plan contributes a twelfth.
    -- Trials contribute nothing — counting money nobody has agreed to pay
    -- is how a forecast becomes a lie.
    'mrr', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'currency', currency,
        'amount_minor', total,
        'companies', n
      ) ORDER BY total DESC), '[]'::jsonb)
      FROM (
        SELECT currency,
               sum(CASE WHEN interval = 'year' THEN amount_minor / 12 ELSE amount_minor END)::BIGINT AS total,
               count(*) AS n
        FROM live
        WHERE state IN ('current', 'due_soon', 'overdue', 'no_period')
        GROUP BY currency
      ) t
    ),
    'collected_30d', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'currency', currency, 'amount_minor', total
      ) ORDER BY total DESC), '[]'::jsonb)
      FROM (
        SELECT currency, sum(amount_minor)::BIGINT AS total
        FROM billing_payments
        WHERE paid_at > now() - interval '30 days'
        GROUP BY currency
      ) t
    ),
    'overdue',   (SELECT count(*) FROM states WHERE state = 'overdue'),
    'due_soon',  (SELECT count(*) FROM states WHERE state = 'due_soon'),
    'trialing',  (SELECT count(*) FROM states WHERE state = 'trialing'),
    'unbilled',  (SELECT count(*) FROM states WHERE state IN ('unbilled', 'no_period')),
    'canceled',  (SELECT count(*) FROM states WHERE state = 'canceled')
  )
$$;

REVOKE ALL ON FUNCTION public.operator_billing_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_billing_overview() TO service_role;

-- ---------- one company's billing ----------

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
        'notes', ab.notes
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
