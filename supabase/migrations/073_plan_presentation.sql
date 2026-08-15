-- ============================================================
-- 073_plan_presentation.sql — what a plan says for itself
--
-- A pricing section needs more per plan than a name and a number, and the
-- alternative to storing it is inventing it. Writing "Everything in
-- Starter, plus priority support" into the page would be a claim about
-- what a customer gets, made up by the person building the page rather
-- than by the business — and it would be on the internet, in front of the
-- people it makes promises to.
--
-- So the copy is data, like the price. Both fields are optional: a plan
-- with neither renders as a name and an amount, which is thin but true.
--
-- Unlike amount and currency, these two are safe to edit in place. They
-- describe the offer rather than constituting it, so changing them does
-- not rewrite what an existing customer agreed to pay.
-- ============================================================

ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS description TEXT,
  -- Marks the plan a pricing page should draw attention to. Not a
  -- discount or a tier ordering, just emphasis.
  ADD COLUMN IF NOT EXISTS highlight BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one plan can be highlighted: two "recommended" options is the
-- same as none, and enforcing it here means the UI does not have to.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_plans_one_highlight
  ON billing_plans ((highlight)) WHERE highlight;

-- The public view republished with the new columns. It has to be listed
-- explicitly — that is the point of using a view rather than a policy.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW can
-- only append columns, and description belongs next to name rather than
-- bolted on the end.
DROP VIEW IF EXISTS public_plans;

CREATE VIEW public_plans
WITH (security_invoker = false) AS
  SELECT id, name, description, amount_minor, currency, interval, highlight
  FROM billing_plans
  WHERE is_active
  ORDER BY amount_minor;

GRANT SELECT ON public_plans TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
