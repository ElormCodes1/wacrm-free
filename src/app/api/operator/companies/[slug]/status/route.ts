import { NextResponse } from 'next/server';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { privilegedClient } from '@/lib/supabase/privileged';

/**
 * Suspend or reactivate a company.
 *
 * This is the sharpest tool in the console. Suspension is checked inside
 * is_account_member(), which 109 RLS policies call, so it takes effect on
 * the customer's very next request — not when their session expires.
 * Every table goes dark at once, mid-session, while they are working.
 *
 * Three guards, each for a specific way this goes wrong:
 *
 *   * The operator session is re-checked here rather than trusted from
 *     the page that rendered the button. A POST is reachable directly.
 *
 *   * Suspending requires the operator to type the company's name back.
 *     The console lists companies in one column, and the row above the
 *     one you meant belongs to somebody else who is paying you.
 *
 *   * A reason is required and stored. "Why is this customer locked out"
 *     is asked days later, by someone else, and an empty column cannot
 *     answer it.
 *
 * Reactivating needs neither: it restores access rather than removing it,
 * and putting friction in front of undoing a mistake only lengthens the
 * outage.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const operator = await getOperator();
    if (!operator) {
      return NextResponse.json({ error: 'Not signed in as an operator' }, { status: 401 });
    }

    const { slug } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
      reason?: string;
      confirmName?: string;
    };

    const next = body.status;
    if (next !== 'active' && next !== 'suspended') {
      return NextResponse.json(
        { error: 'status must be "active" or "suspended"' },
        { status: 400 }
      );
    }

    const db = privilegedClient('operator');
    const { data: account } = await db
      .from('accounts')
      .select('id, name, slug, status')
      .eq('slug', slug)
      .maybeSingle();

    if (!account) {
      return NextResponse.json({ error: 'No company at that address' }, { status: 404 });
    }

    const accountId = account.id as string;
    const name = account.name as string;

    if (account.status === next) {
      return NextResponse.json({ error: `Already ${next}` }, { status: 409 });
    }

    const reason = (body.reason ?? '').trim();

    if (next === 'suspended') {
      // Compared loosely: an operator retyping a name should not be
      // defeated by a trailing space or a capital letter. It is a check
      // against picking the wrong row, not against a determined attacker
      // — who is already an operator and does not need to guess.
      const typed = (body.confirmName ?? '').trim().toLowerCase();
      if (typed !== name.trim().toLowerCase()) {
        return NextResponse.json(
          { error: `Type the company name exactly ("${name}") to confirm` },
          { status: 400 }
        );
      }
      if (reason.length < 3) {
        return NextResponse.json(
          { error: 'A reason is required — it is what explains the lockout later' },
          { status: 400 }
        );
      }
    }

    const { error } = await db
      .from('accounts')
      .update(
        next === 'suspended'
          ? { status: 'suspended', suspended_at: new Date().toISOString(), suspended_reason: reason }
          : { status: 'active', suspended_at: null, suspended_reason: null }
      )
      .eq('id', accountId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Recorded after the change, and deliberately allowed to throw: an
    // unrecorded suspension is worse than a failed one, and the caller
    // seeing an error will look, whereas a silent gap in the trail is
    // found only when someone goes looking for it.
    await recordOperatorAction({
      operator,
      action: next === 'suspended' ? 'company.suspend' : 'company.reactivate',
      targetAccountId: accountId,
      detail: { slug, name, reason: reason || null },
      ip: request.headers.get('x-forwarded-for'),
    });

    return NextResponse.json({ ok: true, status: next });
  } catch (error) {
    console.error('Error changing company status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
