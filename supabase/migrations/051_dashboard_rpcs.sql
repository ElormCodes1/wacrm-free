-- ============================================================
-- 051_dashboard_rpcs.sql — push dashboard aggregation into SQL
--
-- The dashboard used to pull every message in a time window into the
-- browser and aggregate in JS (loadConversationsSeries, loadResponseTime).
-- These two functions do the aggregation in Postgres so the client
-- receives a handful of rows instead of thousands, keeping the dashboard
-- fast as message volume grows.
--
-- Both are SECURITY INVOKER: RLS on messages/conversations still scopes
-- every row to the caller's account. `p_config` optionally narrows to one
-- connected WhatsApp number (the header scope selector).
-- ============================================================

-- Messages-per-day, split incoming (customer) vs outgoing (agent/bot).
-- Bucketed in the caller's timezone (p_tz, an IANA name) so day
-- boundaries match what the user sees. Only returns days that have rows;
-- the client seeds zero-days for the full range.
CREATE OR REPLACE FUNCTION dashboard_conversation_series(
  p_start timestamptz,
  p_tz text,
  p_config uuid DEFAULT NULL
)
RETURNS TABLE (day date, incoming bigint, outgoing bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (m.created_at AT TIME ZONE p_tz)::date AS day,
    count(*) FILTER (WHERE m.sender_type = 'customer')  AS incoming,
    count(*) FILTER (WHERE m.sender_type <> 'customer') AS outgoing
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.created_at >= p_start
    AND (p_config IS NULL OR c.whatsapp_config_id = p_config)
  GROUP BY 1
$$;

-- Response-time samples: for each "customer streak" (a customer message
-- whose previous message in the conversation was NOT from the customer),
-- pair it with the first subsequent agent/bot reply. Returns one row per
-- replied streak with the wait in minutes. Mirrors the old JS pairing
-- exactly; the client still buckets by day-of-week / this-vs-last week
-- (which needs the caller's local timezone), so we return raw timestamps.
CREATE OR REPLACE FUNCTION dashboard_response_samples(
  p_start timestamptz,
  p_config uuid DEFAULT NULL
)
RETURNS TABLE (customer_at timestamptz, response_minutes double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ordered AS (
    SELECT
      m.conversation_id,
      m.created_at,
      (m.sender_type = 'customer') AS is_customer,
      lag(m.sender_type = 'customer') OVER (
        PARTITION BY m.conversation_id ORDER BY m.created_at
      ) AS prev_is_customer
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.created_at >= p_start
      AND (p_config IS NULL OR c.whatsapp_config_id = p_config)
  ),
  streak_starts AS (
    SELECT conversation_id, created_at AS customer_at
    FROM ordered
    WHERE is_customer AND prev_is_customer IS DISTINCT FROM true
  )
  SELECT
    s.customer_at,
    EXTRACT(EPOCH FROM (r.response_at - s.customer_at)) / 60.0 AS response_minutes
  FROM streak_starts s
  CROSS JOIN LATERAL (
    SELECT min(o.created_at) AS response_at
    FROM ordered o
    WHERE o.conversation_id = s.conversation_id
      AND NOT o.is_customer
      AND o.created_at > s.customer_at
  ) r
  WHERE r.response_at IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION dashboard_conversation_series(timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_response_samples(timestamptz, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
