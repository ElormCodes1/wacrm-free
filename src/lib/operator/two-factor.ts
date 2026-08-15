import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { privilegedClient } from '@/lib/supabase/privileged';
import { sealSecret, openSecret } from './secret-box';
import { generateTotpSecret, verifyTotp } from './totp';

/**
 * Enrolment, verification and recovery for the operator second factor.
 *
 * The shape worth noticing: a secret is generated and stored BEFORE it is
 * confirmed, but totp_enabled_at stays null until a code has been checked.
 * So an operator who starts enrolling and closes the tab is not locked
 * out — their account still signs in with a password alone, because they
 * never proved their authenticator works. Turning 2FA on at the moment
 * the secret is generated is the standard way to lock somebody out of
 * their own account.
 */

const RECOVERY_CODE_COUNT = 8;

export interface TwoFactorState {
  enrolled: boolean;
  /** Only while enrolment is in progress; null once confirmed. */
  pendingSecret: string | null;
  recoveryCodesLeft: number;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export async function getTwoFactorState(userId: string): Promise<TwoFactorState> {
  const db = privilegedClient('operator');
  const { data } = await db
    .from('operators')
    .select('totp_secret, totp_enabled_at')
    .eq('user_id', userId)
    .maybeSingle();

  const { count } = await db
    .from('operator_recovery_codes')
    .select('id', { count: 'exact', head: true })
    .eq('operator_user_id', userId)
    .is('used_at', null);

  const enrolled = Boolean(data?.totp_enabled_at);
  return {
    enrolled,
    pendingSecret: enrolled ? null : openSecret(data?.totp_secret as string | null),
    recoveryCodesLeft: count ?? 0,
  };
}

/**
 * Start enrolment: mint a secret and store it sealed, unconfirmed.
 *
 * Re-running this replaces an unconfirmed secret, which is what someone
 * who abandoned a setup and started again expects. It refuses to touch a
 * CONFIRMED one — turning off a working second factor is a separate,
 * deliberate act, not a side effect of loading a page.
 */
export async function beginEnrolment(
  userId: string
): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const db = privilegedClient('operator');
  const { data } = await db
    .from('operators')
    .select('totp_enabled_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (data?.totp_enabled_at) {
    return { ok: false, error: 'Two-factor is already on. Turn it off first to re-enrol.' };
  }

  const secret = generateTotpSecret();
  const { error } = await db
    .from('operators')
    .update({ totp_secret: sealSecret(secret) })
    .eq('user_id', userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, secret };
}

/**
 * Finish enrolment by proving the app produces matching codes.
 *
 * Recovery codes are issued here and returned once. They are shown at the
 * only moment they can be — after this, only their hashes exist.
 */
export async function confirmEnrolment(
  userId: string,
  code: string
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const db = privilegedClient('operator');
  const { data } = await db
    .from('operators')
    .select('totp_secret, totp_enabled_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (data?.totp_enabled_at) return { ok: false, error: 'Two-factor is already on.' };

  const secret = openSecret(data?.totp_secret as string | null);
  if (!secret) return { ok: false, error: 'Start the setup again — no pending secret was found.' };
  if (!verifyTotp(secret, code)) return { ok: false, error: 'That code is not right. Try the next one.' };

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    // Base32-ish, uppercase, no ambiguous characters — these get written
    // on paper and typed back under stress.
    randomBytes(5).toString('hex').toUpperCase().replace(/0/g, 'G').replace(/1/g, 'H')
  );

  await db.from('operator_recovery_codes').delete().eq('operator_user_id', userId);
  await db.from('operator_recovery_codes').insert(
    codes.map((c) => ({ operator_user_id: userId, code_hash: hashCode(c) }))
  );

  const { error } = await db
    .from('operators')
    .update({ totp_enabled_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, recoveryCodes: codes };
}

/** Turn it off, clearing the secret and every unused recovery code. */
export async function disableTwoFactor(userId: string): Promise<void> {
  const db = privilegedClient('operator');
  await db.from('operator_recovery_codes').delete().eq('operator_user_id', userId);
  await db
    .from('operators')
    .update({ totp_secret: null, totp_enabled_at: null })
    .eq('user_id', userId);
}

/**
 * Check a code at sign-in: either a live TOTP code or a recovery code.
 *
 * A recovery code is consumed by the check — marked used before this
 * returns, so a captured one cannot be replayed even in the same second.
 */
export async function verifySecondFactor(
  userId: string,
  submitted: string
): Promise<{ ok: boolean; usedRecoveryCode: boolean }> {
  const db = privilegedClient('operator');
  const { data } = await db
    .from('operators')
    .select('totp_secret, totp_enabled_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data?.totp_enabled_at) return { ok: true, usedRecoveryCode: false };

  const secret = openSecret(data.totp_secret as string | null);
  if (secret && verifyTotp(secret, submitted)) {
    return { ok: true, usedRecoveryCode: false };
  }

  // Recovery path. Looked up by hash so a wrong code reveals nothing, and
  // claimed with a conditional update so two simultaneous attempts cannot
  // both succeed with the same code.
  const hash = hashCode(submitted);
  const { data: claimed } = await db
    .from('operator_recovery_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('operator_user_id', userId)
    .eq('code_hash', hash)
    .is('used_at', null)
    .select('id');

  if (claimed && claimed.length > 0) {
    return { ok: true, usedRecoveryCode: true };
  }

  return { ok: false, usedRecoveryCode: false };
}

/** Is a second factor required for this operator? */
export async function requiresSecondFactor(userId: string): Promise<boolean> {
  const db = privilegedClient('operator');
  const { data } = await db
    .from('operators')
    .select('totp_enabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.totp_enabled_at);
}

/** Constant-time compare, exported for tests of the recovery path. */
export function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(hashCode(a));
  const y = Buffer.from(hashCode(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
