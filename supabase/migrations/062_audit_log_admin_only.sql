-- ============================================================
-- 062_audit_log_admin_only.sql — restrict the audit log to admins
--
-- 061 let any account member read the trail. It records who changed what
-- across the whole account, including colleagues' actions — oversight
-- data, which belongs with the roles that already administer the account.
-- An agent able to review their own supervision inverts the point of
-- keeping it.
--
-- Enforced in the database, not only in the UI: hiding the settings tab
-- stops it appearing, but the API would still answer anyone who asked.
-- ============================================================

DROP POLICY IF EXISTS "Members can read their audit log" ON audit_log;

CREATE POLICY "Admins can read their audit log" ON audit_log
  FOR SELECT USING (is_account_member(account_id, 'admin'::account_role_enum));

NOTIFY pgrst, 'reload schema';
