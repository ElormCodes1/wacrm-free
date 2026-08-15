import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { privilegedClient } from '@/lib/supabase/privileged';
import { issueOperatorSession, recordOperatorAction } from '@/lib/operator/session';

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
    const { email, password } = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

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

    await issueOperatorSession(operator.user_id as string, operator.name as string);
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
