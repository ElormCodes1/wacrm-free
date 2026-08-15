-- ============================================================
-- 077_operator_2fa.sql — a second factor on the operator plane
--
-- One password currently stands between an attacker and every customer's
-- data: the operator console can read any company, suspend any company,
-- and see every payment. That is the account most worth attacking in the
-- system and the only one with no second factor.
--
-- Two decisions worth stating:
--
--   The secret is stored ENCRYPTED, not merely behind RLS. RLS defends
--   against the application being wrong; it does nothing about a leaked
--   backup or a stray service-role key, which would otherwise hand over
--   the very thing meant to survive a stolen password.
--
--   RECOVERY CODES are not optional. An operator who loses their phone
--   would otherwise be locked out of the platform they run, and the only
--   way back would be a hand-written UPDATE against production by
--   whoever still has database access — which is a worse security story
--   than the one 2FA was added to fix.
-- ============================================================

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;

COMMENT ON COLUMN operators.totp_secret IS
  'AES-256-GCM sealed TOTP secret (see lib/operator/secret-box). Never plaintext.';
COMMENT ON COLUMN operators.totp_enabled_at IS
  'Set once a code has been verified. Enrolment is only complete when the operator has proved their app works.';

CREATE TABLE IF NOT EXISTS operator_recovery_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- SHA-256 of the code. Stored hashed for the same reason passwords are:
  -- a recovery code IS a credential, and one that bypasses the second
  -- factor entirely.
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_recovery_unused
  ON operator_recovery_codes (operator_user_id) WHERE used_at IS NULL;

-- A code must be usable exactly once, and the uniqueness has to hold
-- across operators so a code cannot be replayed against another account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_recovery_hash
  ON operator_recovery_codes (code_hash);

ALTER TABLE operator_recovery_codes ENABLE ROW LEVEL SECURITY;
-- No policy, like the operators table: service role only.

NOTIFY pgrst, 'reload schema';
