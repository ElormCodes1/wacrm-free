-- ============================================================
-- 065_company_slug_from_name.sql — every company gets its own address
--
-- The address is the company's own name, derived automatically when they
-- sign up. Nothing is hardcoded and nothing is assigned by hand: a
-- customer types "Bright Motors" and gets /bright-motors.
--
-- Until now signup named the account after the PERSON (their full_name)
-- and set no slug at all, which is why an address had to be inserted
-- manually afterwards. Signup now captures the company name, and this
-- derives the address from it.
--
-- Two rules matter more than elegance here, because the result is printed:
--
--   * Signup must never fail because of the address. A company legitimately
--     called "Status" or one whose name is already taken still has to get
--     in, so a colliding or reserved slug gets a numeric suffix rather than
--     an error. "status-2" is a poor address; "you cannot sign up" is worse.
--
--   * What they end up with must be visible to them immediately, since it
--     is the thing they will print. The signup UI shows the derived address
--     as they type.
-- ============================================================

-- Folds accents to ASCII: "Café Déjà Vu" must become cafe-deja-vu, not
-- caf-d-j-vu. Stripping accented letters mangles the name of any company
-- that has one, and the address is the thing they print.
CREATE EXTENSION IF NOT EXISTS unaccent;

/**
 * Turn a company name into a candidate address.
 *
 * Lowercase, spaces and punctuation to hyphens, accents folded where
 * Postgres can, collapsed and trimmed. Deliberately conservative: the
 * output has to survive being read down a phone and typed from memory.
 */
-- STABLE rather than IMMUTABLE: unaccent() depends on a dictionary, so
-- Postgres will not let it be called from an IMMUTABLE function.
CREATE OR REPLACE FUNCTION public.slugify(raw TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT
    trim(both '-' from
      regexp_replace(
        regexp_replace(
          lower(unaccent(coalesce(raw, ''))),
          -- Anything that is not a letter, digit or hyphen becomes a hyphen.
          '[^a-z0-9]+', '-', 'g'
        ),
        -- Collapse runs: "A  &  B" would otherwise give "a---b".
        '-{2,}', '-', 'g'
      )
    )
$$;

/**
 * A free, valid address derived from a company name.
 *
 * Applies the same rules the accounts trigger enforces — length, shape,
 * reserved words, uniqueness — and walks a numeric suffix until it finds
 * one that is free. Returns NULL only if the name contains nothing
 * usable at all, which the caller must handle.
 */
CREATE OR REPLACE FUNCTION public.available_company_slug(company_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  base      TEXT;
  candidate TEXT;
  suffix    INT := 1;
BEGIN
  base := public.slugify(company_name);

  -- Too short to be an address. "3" or "&" leaves nothing to work with.
  IF length(base) < 3 THEN
    RETURN NULL;
  END IF;

  -- The stored column allows 40 characters; leave room for a suffix so a
  -- long name does not fail only on its second occurrence.
  IF length(base) > 36 THEN
    base := trim(both '-' from substring(base from 1 for 36));
  END IF;

  candidate := base;
  LOOP
    IF NOT EXISTS (SELECT 1 FROM reserved_slugs r WHERE r.word = candidate)
       AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.slug = candidate) THEN
      RETURN candidate;
    END IF;
    suffix := suffix + 1;
    -- Give up rather than spin: at this point the name is pathological.
    IF suffix > 999 THEN
      RETURN NULL;
    END IF;
    candidate := base || '-' || suffix;
  END LOOP;
END;
$$;

-- ---------- signup ----------

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
BEGIN
  v_full_name    := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  -- The company name is what the address is built from. Falling back to a
  -- person's name keeps older signup forms working rather than leaving an
  -- account with no address at all.
  v_company_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
    NULLIF(v_full_name, ''),
    NEW.email,
    'My company'
  );

  v_slug := public.available_company_slug(v_company_name);
  -- Nothing usable in the name (punctuation only, or 999 collisions).
  -- Fall back to something unique rather than refusing to create the
  -- account; the owner can be given a better address before they print it.
  IF v_slug IS NULL THEN
    v_slug := 'company-' || substring(replace(NEW.id::text, '-', '') from 1 for 10);
  END IF;

  INSERT INTO public.accounts (name, owner_user_id, slug)
  VALUES (v_company_name, NEW.id, v_slug)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ---------- existing companies without an address ----------
--
-- Anything created before this migration has no slug and therefore no
-- reachable address. Derive one from the name it already has.

UPDATE accounts
SET slug = public.available_company_slug(name)
WHERE slug IS NULL
  AND public.available_company_slug(name) IS NOT NULL;

NOTIFY pgrst, 'reload schema';
