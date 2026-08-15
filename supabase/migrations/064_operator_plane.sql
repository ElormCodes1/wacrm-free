-- ============================================================
-- 064_operator_plane.sql — the level above customers
--
-- Operators (us) can see across companies. Customers cannot, no matter
-- how privileged they are inside their own company: an owner is the top
-- of THEIR company and nothing more.
--
-- The rule that shapes this design is "no customer session, however
-- privileged, may be escalated or converted into an operator session".
-- That rules out a role flag on profiles — a flag is exactly a
-- convertible privilege, and one mistaken UPDATE would turn a customer
-- into an operator. Instead:
--
--   * Operator identity lives in its own table, keyed to an auth user
--     that belongs to NO company. A trigger enforces that, so an operator
--     cannot also be a member of a customer's account.
--
--   * Holding a customer session grants nothing here. Operator routes
--     additionally require a separate, short-lived operator cookie that
--     can only be minted by signing in again at the operator entrance.
--     Being signed in as a customer is not a step towards obtaining one.
--
--   * Nothing in this table is readable through the customer API. RLS is
--     on with no policy at all, so PostgREST returns nothing to anon or
--     authenticated; only the service role — reached through the single
--     privileged door — can read it.
-- ============================================================

CREATE TABLE IF NOT EXISTS operators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

-- An operator must not also be a customer. Without this, "operator" is
-- just another hat a customer can wear, and the separation is a comment
-- rather than a guarantee.
CREATE OR REPLACE FUNCTION public.assert_operator_not_customer()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = NEW.user_id AND p.account_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'OPERATOR_IS_CUSTOMER: % already belongs to a company; operators must be separate identities', NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operators_not_customers ON operators;
CREATE TRIGGER operators_not_customers
  BEFORE INSERT OR UPDATE ON operators
  FOR EACH ROW EXECUTE FUNCTION public.assert_operator_not_customer();

-- The same guarantee from the other direction: a customer profile cannot
-- be attached to a user who is an operator.
CREATE OR REPLACE FUNCTION public.assert_customer_not_operator()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM operators o WHERE o.user_id = NEW.user_id) THEN
    RAISE EXCEPTION
      'CUSTOMER_IS_OPERATOR: % is an operator; operator identities cannot join a company', NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_not_operators ON profiles;
CREATE TRIGGER profiles_not_operators
  BEFORE INSERT OR UPDATE OF account_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.assert_customer_not_operator();

ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy: unreachable through the customer API entirely.

-- ---------- audit ----------
--
-- "Operator actions across customer data should leave a record of who did
-- what." Written by the operator code path rather than by triggers,
-- because what matters here is the INTENT — which operator looked at
-- which company and why — not the row-level diff the customer audit log
-- already captures.

CREATE TABLE IF NOT EXISTS operator_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operator_name TEXT,
  action TEXT NOT NULL,
  -- Which company was touched. Null for actions that span all of them.
  target_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  detail JSONB,
  ip TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_audit_time
  ON operator_audit (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_audit_account
  ON operator_audit (target_account_id, occurred_at DESC);

ALTER TABLE operator_audit ENABLE ROW LEVEL SECURITY;
-- No policy, for the same reason as above, and additionally so that an
-- operator cannot erase their own trail through the ordinary API.

NOTIFY pgrst, 'reload schema';
