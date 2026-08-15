-- ============================================================
-- 063_tenancy_identity.sql — company identity and lifecycle
--
-- The data layer was already multi-tenant: 32 tables carry account_id and
-- 109 policies gate on is_account_member(). What was missing is identity
-- (a public, printable name and branding), lifecycle (suspend a company,
-- deactivate a person), and a guarantee that a printed address never
-- changes meaning.
--
-- Two decisions worth stating, because both are hard to reverse later:
--
--   * The slug is IMMUTABLE once set. It goes on posters and is read down
--     a phone; the moment it is printed it belongs to the physical world,
--     and a rename would silently repoint something already in someone's
--     hand. Enforced by trigger, not convention.
--
--   * Suspension and deactivation are enforced inside is_account_member(),
--     the predicate all 109 policies already call. Putting them there
--     means they take effect on the next QUERY — for every table at once —
--     rather than at session expiry, and no future table can forget to
--     honour them. A per-route check would be 40-odd places to remember
--     and one place to miss.
-- ============================================================

-- ---------- company identity ----------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status_enum') THEN
    CREATE TYPE account_status_enum AS ENUM ('active', 'suspended');
  END IF;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS status account_status_enum NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS brand_color TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

COMMENT ON COLUMN accounts.slug IS
  'Public, printable address segment. Immutable once set — it appears on '
  'printed material, so changing it would repoint something already issued.';

-- ---------- reserved words ----------
--
-- A company must not be able to claim a name that collides with a page in
-- the app, in either direction. Being shadowed BY a page is the worse
-- failure: Next resolves a static segment before a dynamic one, so the
-- company's staff would land on an app page that looks broken rather than
-- on something that explains itself.
--
-- Reserving costs nothing; reclaiming a word from a customer who has
-- printed it is impossible. So this list is deliberately generous, and
-- `source` records why each word is held so nobody prunes it later
-- thinking it was arbitrary.

CREATE TABLE IF NOT EXISTS reserved_slugs (
  word TEXT PRIMARY KEY,
  -- 'route'    — a real URL segment in the app today (generated)
  -- 'future'   — a word a hosted product will want
  -- 'manual'   — held deliberately for another reason
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reserved_slugs ENABLE ROW LEVEL SECURITY;
-- Readable by anyone signed in (signup needs to explain a rejection);
-- writable only by the service role, which is how the generator syncs it.
DROP POLICY IF EXISTS "Anyone signed in can read reserved words" ON reserved_slugs;
CREATE POLICY "Anyone signed in can read reserved words" ON reserved_slugs
  FOR SELECT TO authenticated USING (true);

-- Words a hosted product wants, independent of today's routes. The route
-- segments themselves are synced from the filesystem (see the generator)
-- so that adding a page protects its own name without anyone remembering.
INSERT INTO reserved_slugs (word, source) VALUES
  ('admin','future'), ('operator','future'), ('operators','future'),
  ('billing','future'), ('account','future'), ('accounts','future'),
  ('auth','future'), ('login','future'), ('logout','future'),
  ('signin','future'), ('signup','future'), ('register','future'),
  ('password','future'), ('reset','future'), ('verify','future'),
  ('invite','future'), ('invites','future'), ('join','future'),
  ('app','future'), ('www','future'), ('api','future'), ('cdn','future'),
  ('static','future'), ('assets','future'), ('public','future'),
  ('docs','future'), ('doc','future'), ('help','future'), ('support','future'),
  ('status','future'), ('blog','future'), ('about','future'), ('pricing','future'),
  ('terms','future'), ('privacy','future'), ('legal','future'), ('security','future'),
  ('contact','future'), ('sales','future'), ('demo','future'), ('trial','future'),
  ('onboarding','future'), ('welcome','future'), ('home','future'),
  ('dashboard','future'), ('settings','future'), ('profile','future'),
  ('search','future'), ('health','future'), ('metrics','future'),
  ('webhook','future'), ('webhooks','future'), ('callback','future'),
  ('oauth','future'), ('sso','future'), ('mail','future'), ('email','future'),
  ('new','future'), ('create','future'), ('edit','future'), ('delete','future'),
  ('test','future'), ('testing','future'), ('staging','future'), ('dev','future')
ON CONFLICT (word) DO NOTHING;

-- ---------- slug rules ----------

CREATE OR REPLACE FUNCTION public.normalise_slug(raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(trim(raw))
$$;

CREATE OR REPLACE FUNCTION public.validate_account_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.slug := public.normalise_slug(NEW.slug);

  -- A real word someone can say down a phone and type from memory.
  IF NEW.slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN
    RAISE EXCEPTION 'INVALID_SLUG: must be 3-40 characters, lowercase letters, numbers and hyphens, not starting or ending with a hyphen'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Guard against a slug that only differs by hyphens, which reads as the
  -- same word aloud and is a support call waiting to happen.
  IF NEW.slug LIKE '%--%' THEN
    RAISE EXCEPTION 'INVALID_SLUG: cannot contain consecutive hyphens'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM reserved_slugs r WHERE r.word = NEW.slug) THEN
    RAISE EXCEPTION 'RESERVED_SLUG: "%" is reserved by the application', NEW.slug
      USING ERRCODE = 'check_violation';
  END IF;

  -- Immutable once issued. Allowed transition is NULL -> value, once.
  IF TG_OP = 'UPDATE' AND OLD.slug IS NOT NULL AND OLD.slug IS DISTINCT FROM NEW.slug THEN
    RAISE EXCEPTION 'IMMUTABLE_SLUG: a company address cannot be changed once issued (% -> %)', OLD.slug, NEW.slug
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_validate_slug ON accounts;
CREATE TRIGGER accounts_validate_slug
  BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.validate_account_slug();

-- Case-insensitive uniqueness: "Acme" and "acme" are the same word aloud.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_slug ON accounts (slug) WHERE slug IS NOT NULL;

-- ---------- people lifecycle ----------

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- ---------- the predicate everything already gates on ----------
--
-- Adding the two lifecycle checks here is what makes "cuts off on their
-- very next action" true without touching a single policy or route: all
-- 109 policies call this, so a suspended company or a deactivated person
-- stops reading and writing every table at the same instant.

CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      -- Lifecycle. Deliberately inside the shared predicate rather than in
      -- each route: enforcement is immediate, total, and cannot be
      -- forgotten by a table added next year.
      AND p.is_active
      AND a.status = 'active'
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

-- ---------- public branding lookup ----------
--
-- Branding must render BEFORE anyone signs in, so this needs to be
-- readable anonymously. It exposes only what goes on the sign-in page —
-- never membership, counts, or anything about the company's data. A
-- suspended company is included deliberately: the address must say what
-- happened rather than 404, which reads as "the app is down".

CREATE OR REPLACE VIEW public_company_branding
WITH (security_invoker = false) AS
  SELECT slug, name, logo_url, brand_color, status
  FROM accounts
  WHERE slug IS NOT NULL;

GRANT SELECT ON public_company_branding TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
