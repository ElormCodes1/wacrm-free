-- ============================================================
-- 069_operator_company_list.sql — the company table in one query
--
-- listCompanies() fetched the accounts and then ran three count queries
-- PER COMPANY to fill in members, numbers and contacts. Two customers made
-- that seven round trips; a hundred would make it three hundred and one,
-- and the console would get slower in exact proportion to the business
-- doing well.
--
-- It also could not show last activity at all, because that needs an
-- aggregate over conversations that PostgREST cannot express inline —
-- which is why the table had no "last seen" column, the one an operator
-- most wants when scanning for customers who have gone quiet.
--
-- Same lockdown as 068: SECURITY DEFINER, EXECUTE revoked from anon and
-- authenticated, granted to service_role only.
-- ============================================================

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
  last_activity_at TIMESTAMPTZ
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
    (SELECT max(v.last_message_at) FROM conversations v WHERE v.account_id = a.id)
  FROM accounts a
  WHERE search IS NULL
     OR btrim(search) = ''
     -- Plain ILIKE on two columns. The search box is for finding a customer
     -- you already know the name of, not for ranking.
     OR a.name ILIKE '%' || btrim(search) || '%'
     OR a.slug ILIKE '%' || btrim(search) || '%'
  ORDER BY a.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.operator_company_list(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_company_list(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
