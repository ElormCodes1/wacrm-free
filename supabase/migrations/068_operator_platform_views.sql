-- ============================================================
-- 068_operator_platform_views.sql — numbers for the operator console
--
-- The console could show per-company counts but nothing about the
-- platform, and nothing about what is currently BROKEN in a company —
-- which is the question support actually starts from.
--
-- These are SQL functions rather than a pile of PostgREST calls for two
-- reasons. Counting messages per company needs a join (messages carry no
-- account_id, only conversation_id), which over PostgREST becomes one
-- request per company; and the overview is a dozen aggregates that have
-- no business being a dozen round trips.
--
-- SECURITY DEFINER, and therefore locked down explicitly. A function in
-- the public schema is callable through PostgREST by anon and
-- authenticated unless the grant is removed — so a customer could
-- otherwise ask the database how many companies exist and how they are
-- doing. EXECUTE is revoked from everyone and granted only to
-- service_role, which is reachable solely through the privileged client.
-- ============================================================

-- ---------- platform overview ----------

CREATE OR REPLACE FUNCTION public.operator_platform_overview()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'companies_total',     (SELECT count(*) FROM accounts),
    'companies_active',    (SELECT count(*) FROM accounts WHERE status = 'active'),
    'companies_suspended', (SELECT count(*) FROM accounts WHERE status = 'suspended'),
    'signups_7d',          (SELECT count(*) FROM accounts WHERE created_at > now() - interval '7 days'),
    'signups_30d',         (SELECT count(*) FROM accounts WHERE created_at > now() - interval '30 days'),

    'numbers_total',       (SELECT count(*) FROM whatsapp_config),
    -- The stored column, which the health sweep keeps honest. A live probe
    -- of every instance on every page load would make the console slow and
    -- hammer the gateway.
    'numbers_connected',   (SELECT count(*) FROM whatsapp_config WHERE connection_state = 'open'),

    'contacts_total',      (SELECT count(*) FROM contacts),
    'messages_24h',        (SELECT count(*) FROM messages WHERE created_at > now() - interval '24 hours'),
    'messages_7d',         (SELECT count(*) FROM messages WHERE created_at > now() - interval '7 days'),

    -- Dormant: nothing has arrived or been sent in 30 days. The signal
    -- that a customer has quietly stopped using this, which no billing
    -- system would tell you either.
    'companies_dormant',   (
      SELECT count(*) FROM accounts a
      WHERE a.status = 'active'
        AND a.created_at < now() - interval '30 days'
        AND NOT EXISTS (
          SELECT 1 FROM conversations c
          WHERE c.account_id = a.id
            AND c.last_message_at > now() - interval '30 days'
        )
    ),

    -- Anything worth looking at right now, summed across companies.
    'numbers_down',        (SELECT count(*) FROM whatsapp_config
                            WHERE connection_state IS DISTINCT FROM 'open'),
    'media_failed_7d',     (SELECT count(*) FROM messages
                            WHERE media_status = 'failed'
                              AND created_at > now() - interval '7 days'),
    'automations_failed_7d', (SELECT count(*) FROM automation_logs
                              WHERE status = 'failed'
                                AND created_at > now() - interval '7 days')
  )
$$;

REVOKE ALL ON FUNCTION public.operator_platform_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_platform_overview() TO service_role;

-- ---------- one company's current problems ----------

CREATE OR REPLACE FUNCTION public.operator_company_health(target UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'messages_24h', (
      SELECT count(*) FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = target AND m.created_at > now() - interval '24 hours'
    ),
    'last_inbound_at', (
      SELECT max(m.created_at) FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = target AND m.sender_type = 'customer'
    ),
    'last_outbound_at', (
      SELECT max(m.created_at) FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = target AND m.sender_type = 'agent'
    ),
    -- Computed here rather than in the page: comparing against the clock
    -- during a React render is impure, and the database's clock is the
    -- one that stamped the row anyway.
    'inbound_stale', (
      SELECT coalesce(max(m.created_at) < now() - interval '3 days', false)
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = target AND m.sender_type = 'customer'
    ),
    'media_failed_7d', (
      SELECT count(*) FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = target
        AND m.media_status = 'failed'
        AND m.created_at > now() - interval '7 days'
    ),
    'automations_failed_7d', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = target AND status = 'failed'
        AND created_at > now() - interval '7 days'
    ),
    'automation_last_error', (
      SELECT error_message FROM automation_logs
      WHERE account_id = target AND status = 'failed'
      ORDER BY created_at DESC LIMIT 1
    ),
    'broadcasts_with_failures_7d', (
      SELECT count(*) FROM broadcasts
      WHERE account_id = target AND coalesce(failed_count, 0) > 0
        AND created_at > now() - interval '7 days'
    ),
    'numbers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id,
        'label', w.label,
        'instance_name', w.instance_name,
        'connection_state', w.connection_state,
        'status', w.status,
        'last_error', w.last_registration_error,
        'connected_at', w.connected_at
      ) ORDER BY w.created_at), '[]'::jsonb)
      FROM whatsapp_config w WHERE w.account_id = target
    )
  )
$$;

REVOKE ALL ON FUNCTION public.operator_company_health(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_company_health(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
