import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { privilegedClient } from '@/lib/supabase/privileged';
import { issueOperatorSession, recordOperatorAction } from '@/lib/operator/session';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { requiresSecondFactor, verifySecondFactor } from '@/lib/operator/two-factor';

/**
 * The operator entrance.
 *
 * Deliberately separate from the customer sign-in, and deliberately not
 * reachable from a customer session: arriving here already signed in as a
 * company owner counts for nothing, because the only thing that mints an
 * operator session is presenting operator credentials AND being listed in
 * the operators table.
 *
 * Credentials are verified with a throwaway client so this cannot
 * accidentally adopt or upgrade whatever session the browser already has.
 */
export async function POST(request: Request) {
  try {
    const { email, password, code } = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      code?: string;
    };
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Per-IP bucket on the front door. The operator plane reads and acts
    // across every tenant, so this is the one sign-in where unlimited
    // guessing is worth a few lines to prevent.
    //
    // x-forwarded-for is spoofable in general, but behind our own proxy it
    // is the only client address available — and a limiter keyed on
    // something forgeable still stops the unsophisticated case, while the
    // per-operator bucket below does not depend on it at all.
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipLimit = checkRateLimit(`operator-signin:${clientIp}`, RATE_LIMITS.operatorSignIn);
    if (!ipLimit.success) return rateLimitResponse(ipLimit);

    // A bare client with no cookie plumbing: verifying a password must not
    // create, read or replace the caller's customer session.
    const auth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: signIn, error: signInError } = await auth.auth.signInWithPassword({
      email,
      password,
    });

    // One message for every failure. Distinguishing "not an operator" from
    // "wrong password" would let anyone enumerate who the operators are.
    const deny = () =>
      NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    if (signInError || !signIn.user) return deny();

    const db = privilegedClient('operator');
    const { data: operator } = await db
      .from('operators')
      .select('user_id, name, is_active')
      .eq('user_id', signIn.user.id)
      .maybeSingle();

    if (!operator || operator.is_active === false) return deny();

    const userId = operator.user_id as string;

    // The second factor, when they have one. Asked for only AFTER the
    // password is known good, so the prompt itself never reveals whether
    // an address belongs to an operator.
    if (await requiresSecondFactor(userId)) {
      if (!code) {
        return NextResponse.json({ mfaRequired: true }, { status: 200 });
      }

      // The bucket that actually matters. By this point the password is
      // known good, and a six-digit code is only a million guesses — with
      // no limit an attacker simply keeps trying against the current
      // 30-second window until one lands. Keyed on the OPERATOR, not the
      // IP, so rotating addresses does not reset it.
      const mfaLimit = checkRateLimit(
        `operator-2fa:${userId}`,
        RATE_LIMITS.operatorSecondFactor,
      );
      if (!mfaLimit.success) {
        await recordOperatorAction({
          operator: { userId, name: operator.name as string, sessionId: 'sign-in' },
          action: 'operator.mfa-rate-limited',
          ip: request.headers.get('x-forwarded-for'),
        });
        return rateLimitResponse(mfaLimit);
      }

      const check = await verifySecondFactor(userId, code);
      if (!check.ok) {
        await recordOperatorAction({
          operator: { userId, name: operator.name as string, sessionId: 'sign-in' },
          action: 'operator.mfa-failed',
          ip: request.headers.get('x-forwarded-for'),
        });
        return NextResponse.json(
          { mfaRequired: true, error: 'That code is not right' },
          { status: 401 }
        );
      }
      if (check.usedRecoveryCode) {
        // Recorded loudly: a recovery code means somebody lost their
        // authenticator, or somebody else is using their codes.
        await recordOperatorAction({
          operator: { userId, name: operator.name as string, sessionId: 'sign-in' },
          action: 'operator.recovery-code-used',
          ip: request.headers.get('x-forwarded-for'),
        });
      }
    }

    await issueOperatorSession(userId, operator.name as string);
    await recordOperatorAction({
      operator: {
        userId: operator.user_id as string,
        name: operator.name as string,
        sessionId: 'sign-in',
      },
      action: 'operator.sign-in',
      ip: request.headers.get('x-forwarded-for'),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in operator sign-in:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
