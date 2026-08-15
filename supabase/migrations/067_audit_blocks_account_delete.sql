-- ============================================================
-- 067_audit_blocks_account_delete.sql — a company could not be deleted
--
-- Deleting an account failed outright:
--
--   ERROR: insert or update on table "audit_log" violates foreign key
--   constraint "audit_log_account_id_fkey"
--
-- The account row goes first, its children cascade, and each child's
-- DELETE fires the audit trigger, which inserts an audit_log row pointing
-- at the account that no longer exists. Any company with a single audited
-- row in it — which is every company that has ever been used — was
-- therefore undeletable.
--
-- That is not only a housekeeping problem. Closing an account and erasing
-- a customer on request both end in this same statement, so the failure
-- would have surfaced the first time either was asked for, under time
-- pressure, on real data.
--
-- The fix is to skip the write when the account is already gone. Nothing
-- is lost by it: audit_log.account_id is ON DELETE CASCADE, so a row
-- written here would be deleted by the very statement that provoked it.
-- The trail for a surviving account is unaffected — this only takes
-- effect when the account itself is being removed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id UUID;
  v_record_id  UUID;
  v_changes    JSONB;
  v_old        JSONB;
  v_new        JSONB;
  v_key        TEXT;
  v_redacted   TEXT[] := public.audit_redacted_columns();
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_account_id := (v_old ->> 'account_id')::UUID;
    v_record_id  := (v_old ->> 'id')::UUID;
    v_changes    := v_old - v_redacted;
  ELSIF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_account_id := (v_new ->> 'account_id')::UUID;
    v_record_id  := (v_new ->> 'id')::UUID;
    v_changes    := v_new - v_redacted;
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_account_id := (v_new ->> 'account_id')::UUID;
    v_record_id  := (v_new ->> 'id')::UUID;
    v_changes    := '{}'::JSONB;
    -- Only the columns that actually changed. A full row snapshot on every
    -- update makes the log unreadable and enormous.
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_key = ANY (v_redacted) THEN CONTINUE; END IF;
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
        );
      END IF;
    END LOOP;
    -- Nothing meaningful changed (a touch of updated_at alone) — don't log.
    IF v_changes = '{}'::JSONB THEN
      RETURN NULL;
    END IF;
  END IF;

  -- No account to attribute it to: skip rather than write an orphan row.
  IF v_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- The account itself is being deleted and these are its children going
  -- with it. The FK would reject the write, and CASCADE would delete it a
  -- moment later even if it did not.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_account_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO audit_log (account_id, actor_user_id, action, table_name, record_id, changes)
  VALUES (v_account_id, auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_record_id, v_changes);

  RETURN NULL; -- AFTER trigger; return value is ignored.
END;
$function$;

NOTIFY pgrst, 'reload schema';
