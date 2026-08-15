-- ============================================================
-- 070_billing.sql — what each customer is on, and whether they have paid
--
-- The console had the lever (suspend) and no way to know who to pull it
-- on: whether a customer had paid lived in a spreadsheet or in somebody's
-- head. This is the missing half.
--
-- Four decisions worth stating, because each is expensive to change once
-- there is real money in the tables:
--
--   * MONEY IS INTEGER MINOR UNITS. 4800 is GHS 48.00. Floating point
--     money accumulates error and then someone is owed a cent that does
--     not exist; there is no upside to it that rounding does not undo.
--
--   * PLANS ARE DATA, NOT CODE. Prices belong to the business, not to a
--     deploy. Nothing here invents a price or a plan name — you create
--     them in the console, and a plan that has been sold is never edited
--     in place (see below).
--
--   * PAYMENTS ARE FACTS, STATUS IS DERIVED. A payment row records that
--     money arrived and is never recalculated. Whether a company is
--     current or overdue is computed from its period end every time it is
--     asked, so there is no scheduled job to flip statuses, and no state
--     that can be stale because a cron did not run at midnight.
--
--   * NOTHING HERE SUSPENDS ANYONE AUTOMATICALLY. Overdue is surfaced
--     loudly and acted on by a person. An automatic lockout would fire on
--     a bank delay, a currency mismatch or a typo in an amount, and the
--     first the customer knows is their business stopping mid-conversation.
--
-- Access: RLS on with NO policy, exactly like the operators table. None of
-- this is reachable through the customer API at all; only the service
-- role, behind the single privileged door, can read or write it. A
-- customer-facing "your plan" view can be added later as an explicit,
-- narrow policy — not by loosening this.
-- ============================================================

-- ---------- plans ----------

CREATE TABLE IF NOT EXISTS billing_plans (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  -- Minor units, e.g. 4800 = 48.00. NOT a numeric: see above.
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency     TEXT NOT NULL DEFAULT 'USD',
  interval     TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year')),
  -- Retiring a plan hides it from the picker without touching anyone
  -- already on it. Deleting it would orphan their subscription, and
  -- editing its price would silently rewrite what they agreed to pay.
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_plans_name
  ON billing_plans (lower(name));

-- ---------- what a company is on ----------

CREATE TABLE IF NOT EXISTS account_billing (
  account_id    UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id       UUID REFERENCES billing_plans(id) ON DELETE RESTRICT,
  -- Intent, not health. Whether they are OVERDUE is derived from
  -- period_end, so this column never needs a nightly job to correct it.
  status        TEXT NOT NULL DEFAULT 'trialing'
                CHECK (status IN ('trialing', 'active', 'canceled')),
  -- The amount actually agreed with this customer, which may differ from
  -- the plan's list price. Null means "whatever the plan says".
  amount_minor  BIGINT CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency      TEXT,
  period_start  TIMESTAMPTZ,
  -- Paid up to here. Past means overdue; that is the whole mechanism.
  period_end    TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- money that arrived ----------

CREATE TABLE IF NOT EXISTS billing_payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     TEXT NOT NULL,
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- How it arrived and what it can be matched against on a statement.
  method       TEXT,
  reference    TEXT,
  note         TEXT,
  -- Who entered it. ON DELETE SET NULL so removing an operator does not
  -- remove the record of money — the same reasoning as operator_audit.
  recorded_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_by_name TEXT,
  -- Set by a payment processor later; a manual entry leaves it null.
  provider     TEXT,
  provider_ref TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_account
  ON billing_payments (account_id, paid_at DESC);

-- A processor must not be able to record the same payment twice on a
-- retry. Partial, so hand-entered rows (null provider) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_provider_ref
  ON billing_payments (provider, provider_ref)
  WHERE provider IS NOT NULL AND provider_ref IS NOT NULL;

-- ---------- lockdown ----------

ALTER TABLE billing_plans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_billing   ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payments  ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: unreachable through the customer API.

-- ---------- keep updated_at honest ----------

DROP TRIGGER IF EXISTS billing_plans_updated_at ON billing_plans;
CREATE TRIGGER billing_plans_updated_at BEFORE UPDATE ON billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS account_billing_updated_at ON account_billing;
CREATE TRIGGER account_billing_updated_at BEFORE UPDATE ON account_billing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- the derived state ----------

/**
 * What to call a company's billing right now.
 *
 * Derived rather than stored, so it cannot disagree with the dates it is
 * computed from. Order matters: canceled beats everything, a live trial
 * beats a missing period, and "unbilled" is a real answer — a company
 * nobody has put on a plan is a thing to notice, not a null to hide.
 */
CREATE OR REPLACE FUNCTION public.billing_state(
  p_status TEXT,
  p_trial_ends_at TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_status IS NULL                              THEN 'unbilled'
    WHEN p_status = 'canceled'                         THEN 'canceled'
    WHEN p_status = 'trialing'
     AND (p_trial_ends_at IS NULL OR p_trial_ends_at > now()) THEN 'trialing'
    WHEN p_period_end IS NULL                          THEN 'no_period'
    WHEN p_period_end < now()                          THEN 'overdue'
    WHEN p_period_end < now() + interval '7 days'      THEN 'due_soon'
    ELSE 'current'
  END
$$;

-- now() makes this STABLE at best; declare it so Postgres does not cache
-- a result across a statement boundary.
ALTER FUNCTION public.billing_state(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) STABLE;

NOTIFY pgrst, 'reload schema';
