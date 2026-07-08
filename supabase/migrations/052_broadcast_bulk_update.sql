-- ============================================================
-- 052_broadcast_bulk_update.sql — one round-trip per send batch
--
-- The broadcast sender updated each recipient's status with its own
-- UPDATE (N sequential round-trips per batch). Because each row carries
-- different values (whatsapp_message_id, sent_at, error), a plain
-- .in() batch won't do — this applies an array of per-row updates in a
-- single statement. SECURITY INVOKER so the existing broadcast_recipients
-- RLS still governs who can update which rows.
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_update_broadcast_recipients(p_updates jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE broadcast_recipients br
  SET status              = u.status,
      sent_at             = COALESCE(u.sent_at, br.sent_at),
      whatsapp_message_id = COALESCE(u.whatsapp_message_id, br.whatsapp_message_id),
      error_message       = u.error_message
  FROM jsonb_to_recordset(p_updates) AS u(
    id                  uuid,
    status              text,
    sent_at             timestamptz,
    whatsapp_message_id text,
    error_message       text
  )
  WHERE br.id = u.id;
$$;

GRANT EXECUTE ON FUNCTION bulk_update_broadcast_recipients(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
