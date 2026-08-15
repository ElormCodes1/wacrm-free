-- ============================================================
-- 066_slug_immutability_hole.sql — close the rename bypass
--
-- 063 made a company's address immutable, but only against a direct
-- change: the check ran AFTER an early return for NULL, so
--
--   UPDATE accounts SET slug = NULL  WHERE ...;
--   UPDATE accounts SET slug = 'new' WHERE ...;
--
-- renamed it in two steps. That is reachable by any account admin —
-- accounts_update grants them UPDATE on their own row — so the guarantee
-- that a printed address never changes meaning did not hold.
--
-- The fix is to compare against OLD.slug before considering NULL at all:
-- once an address has been issued, nothing may clear it or change it.
-- Correcting one (which should be vanishingly rare, and never at a
-- customer's request) now requires deliberately disabling this trigger as
-- a superuser, which is the level of friction a permanent identifier
-- deserves.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_account_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Immutability FIRST. Clearing a slug is a rename in two steps, so it
  -- has to be refused here rather than slipping past a NULL shortcut.
  IF TG_OP = 'UPDATE'
     AND OLD.slug IS NOT NULL
     AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION
      'IMMUTABLE_SLUG: a company address cannot be changed or cleared once issued (% -> %)',
      OLD.slug, COALESCE(NEW.slug, 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.slug IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.slug := public.normalise_slug(NEW.slug);

  IF NEW.slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN
    RAISE EXCEPTION 'INVALID_SLUG: must be 3-40 characters, lowercase letters, numbers and hyphens, not starting or ending with a hyphen'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.slug LIKE '%--%' THEN
    RAISE EXCEPTION 'INVALID_SLUG: cannot contain consecutive hyphens'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM reserved_slugs r WHERE r.word = NEW.slug) THEN
    RAISE EXCEPTION 'RESERVED_SLUG: "%" is reserved by the application', NEW.slug
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
