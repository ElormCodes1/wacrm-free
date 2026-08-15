import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { privilegedClient } from '@/lib/supabase/privileged';
import {
  beginEnrolment,
  confirmEnrolment,
  disableTwoFactor,
} from '@/lib/operator/two-factor';

/**
 * The operator's own security settings.
 *
 * Every destructive action here — changing the password, turning off the
 * second factor — requires the CURRENT password, even though the caller
 * already holds a valid operator session. A session cookie proves who
 * signed in eight hours ago; it does not prove who is at the keyboard
 * now, and an unattended screen is exactly how an account with this much
 * reach gets taken over.
 */
export async function POST(request: Request) {
  try {
    const operator = await getOperator();
    if (!operator) {
      return NextResponse.json({ error: 'Not signed in as an operator' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      currentPassword?: string;
      newPassword?: string;
      code?: string;
    };

    const db = privilegedClient('operator');
    const { data: user } = await db.auth.admin.getUserById(operator.userId);
    const email = user?.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'Could not resolve your account' }, { status: 500 });
    }

    /** Re-prove the password with a throwaway client that cannot touch our session. */
    async function passwordHolds(password?: string): Promise<boolean> {
      if (!password) return false;
      const auth = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { error } = await auth.auth.signInWithPassword({ email: email!, password });
      return !error;
    }

    switch (body.action) {
      case 'begin-2fa': {
        const result = await beginEnrolment(operator.userId);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        return NextResponse.json({ ok: true, secret: result.secret, email });
      }

      case 'confirm-2fa': {
        const result = await confirmEnrolment(operator.userId, body.code ?? '');
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        await recordOperatorAction({ operator, action: 'operator.2fa-enabled' });
        return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes });
      }

      case 'disable-2fa': {
        if (!(await passwordHolds(body.currentPassword))) {
          return NextResponse.json(
            { error: 'Enter your current password to turn two-factor off' },
            { status: 403 }
          );
        }
        await disableTwoFactor(operator.userId);
        // Loud in the trail: removing the second factor is the step an
        // attacker takes after getting in, not something staff do often.
        await recordOperatorAction({ operator, action: 'operator.2fa-disabled' });
        return NextResponse.json({ ok: true });
      }

      case 'change-password': {
        const next = body.newPassword ?? '';
        if (next.length < 12) {
          // Longer than the customer minimum on purpose: this password
          // opens every company's data.
          return NextResponse.json(
            { error: 'Use at least 12 characters for an operator password' },
            { status: 400 }
          );
        }
        if (!(await passwordHolds(body.currentPassword))) {
          return NextResponse.json({ error: 'Your current password is not right' }, { status: 403 });
        }
        const { error } = await db.auth.admin.updateUserById(operator.userId, {
          password: next,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        await recordOperatorAction({ operator, action: 'operator.password-changed' });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in operator security:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
