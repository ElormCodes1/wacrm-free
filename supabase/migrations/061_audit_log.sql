-- ============================================================
-- 061_audit_log.sql — who changed what
--
-- The CRM is multi-agent with shared account access and kept no record of
-- who did anything: a contact renamed, a deal moved, a task reassigned, a
-- WhatsApp number unlinked. With several people in one account that is
-- both an operational problem ("who deleted this?") and a trust one.
--
-- Implemented as database triggers rather than calls in the API routes.
-- There are ~40 mutating routes; instrumenting them one by one gives
-- coverage that LOOKS complete and silently isn't the moment a new route
-- lands or a fix writes directly. A trigger cannot be forgotten: it fires
-- for the API, for RPCs, for the webhook's service-role writes, and for
-- anyone at a psql prompt.
--
-- Actor: auth.uid() when a signed-in user made the change, NULL when the
-- writer was the service role — the webhook and background jobs. NULL
-- honestly means "the system", and is not a gap.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NULL = written by the service role (webhook, automation), not a person.
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  table_name TEXT NOT NULL,
  record_id UUID,
  -- UPDATE: only the columns that actually changed, as {col: {old, new}}.
  -- INSERT/DELETE: the row, minus redacted columns.
  changes JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The queries this table exists to answer: an account's recent activity,
-- and the history of one record.
CREATE INDEX IF NOT EXISTS idx_audit_log_account_time
  ON audit_log (account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record
  ON audit_log (table_name, record_id, occurred_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Readable by account members. Deliberately no insert/update/delete policy:
-- only the SECURITY DEFINER trigger writes, so an audit trail cannot be
-- edited or erased through the API by the person being audited.
DROP POLICY IF EXISTS "Members can read their audit log" ON audit_log;
CREATE POLICY "Members can read their audit log" ON audit_log
  FOR SELECT USING (is_account_member(account_id));

-- ============================================================
-- Trigger
-- ============================================================

-- Never record these. Secrets have no place in an audit trail, and the
-- noisy timestamps would bury the columns a human is looking for.
CREATE OR REPLACE FUNCTION public.audit_redacted_columns()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'access_token', 'api_key', 'apikey', 'secret', 'password',
    'encrypted_token', 'webhook_secret', 'session',
    'updated_at', 'created_at'
  ]
$$;

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO audit_log (account_id, actor_user_id, action, table_name, record_id, changes)
  VALUES (v_account_id, auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_record_id, v_changes);

  RETURN NULL; -- AFTER trigger; return value is ignored.
END;
$$;

-- Attach to the tables where "who did this" is actually asked. Messages
-- are deliberately excluded: they are the highest-volume table by far and
-- already immutable history, so auditing them would multiply storage to
-- record what the thread already shows.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'conversations', 'deals', 'tasks',
    'whatsapp_config', 'automations', 'flows', 'tags'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON public.%1$I', t);
      EXECUTE format(
        'CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
