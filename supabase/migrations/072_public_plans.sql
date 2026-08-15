-- ============================================================
-- 072_public_plans.sql — plans on the signup page
--
-- billing_plans is operator-only: RLS on, no policy, unreachable through
-- the customer API. That is right for the table, which carries retired
-- plans and is written from the console — but a price list is public by
-- nature, and a visitor deciding whether to sign up has to be able to
-- read it.
--
-- Exposed through a narrow VIEW rather than by adding a policy to the
-- table, following public_company_branding from 063. The difference
-- matters: a policy would make the TABLE readable and then rely on the
-- policy's WHERE clause to hide things, so every column added later is
-- public by default and someone has to notice. A view publishes an
-- explicit list of columns, and a new column on the table stays private
-- until someone deliberately adds it here.
--
-- Retired plans are excluded. Nobody should be able to sign up onto a
-- price you have stopped offering.
-- ============================================================

CREATE OR REPLACE VIEW public_plans
WITH (security_invoker = false) AS
  SELECT id, name, amount_minor, currency, interval
  FROM billing_plans
  WHERE is_active
  ORDER BY amount_minor;

GRANT SELECT ON public_plans TO anon, authenticated;

-- ---------- signup can choose one ----------

/**
 * Account bootstrap, now with a plan.
 *
 * The plan id arrives in the signup metadata, which means it comes from
 * the BROWSER and cannot be trusted — the same rule the company slug
 * follows. It is treated as a hint and verified here against
 * billing_plans: an id that does not exist, or names a retired plan, is
 * ignored rather than rejected. Someone whose plan was retired between
 * loading the page and submitting it must still get an account; an
 * operator can put them on the right plan afterwards, and a company with
 * no plan is already a state the console reports as "no plan".
 *
 * The subscription is created as TRIALING with no period end. Nothing has
 * been paid — there is no payment processor in this system — so recording
 * them as active would put money in the revenue figures that nobody has
 * received. They show up in the console as a trial for an operator to
 * collect from.
 */
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_full_name    TEXT;
  v_company_name TEXT;
  v_slug         TEXT;
  v_account_id   UUID;
  v_plan_id      UUID;
BEGIN
  v_full_name    := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_company_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
    NULLIF(v_full_name, ''),
    NEW.email,
    'My company'
  );

  v_slug := public.available_company_slug(v_company_name);
  IF v_slug IS NULL THEN
    v_slug := 'company-' || substring(replace(NEW.id::text, '-', '') from 1 for 10);
  END IF;

  INSERT INTO public.accounts (name, owner_user_id, slug)
  VALUES (v_company_name, NEW.id, v_slug)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  -- The chosen plan, if it is a real, currently-offered one. A bad value
  -- leaves v_plan_id null and the account simply has no plan.
  BEGIN
    v_plan_id := NULLIF(NEW.raw_user_meta_data->>'plan_id', '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    -- Not even a UUID. Ignore it rather than failing the signup.
    v_plan_id := NULL;
  END;

  IF v_plan_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM billing_plans p WHERE p.id = v_plan_id AND p.is_active) THEN
    INSERT INTO public.account_billing (account_id, plan_id, status, currency)
    SELECT v_account_id, p.id, 'trialing', p.currency
    FROM billing_plans p WHERE p.id = v_plan_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
