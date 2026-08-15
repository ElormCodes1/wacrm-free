import { NextResponse } from 'next/server';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { privilegedClient } from '@/lib/supabase/privileged';
import { resolveUpgradeRequest } from '@/lib/operator/billing';

/**
 * Close an upgrade request.
 *
 * Both outcomes are recorded, including "declined" — a customer asking to
 * pay more and being told no is exactly the decision somebody will want
 * explained later, and a trail that only kept the yeses would not have
 * it.
 *
 * Resolving is deliberately NOT automatic when the plan changes. Moving a
 * company up is usually the answer to their request but not always the
 * whole of it, and a request that closes itself would sometimes vanish
 * before anyone replied to the person who raised it.
 */
export async function POST(request: Request) {
  try {
    const operator = await getOperator();
    if (!operator) {
      return NextResponse.json({ error: 'Not signed in as an operator' }, { status: 401 });
    }

    const { id, status } = (await request.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
    };

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (status !== 'done' && status !== 'declined') {
      return NextResponse.json(
        { error: 'status must be "done" or "declined"' },
        { status: 400 }
      );
    }

    // Read it first so the audit entry says which company and why, rather
    // than just an id that means nothing when read back in six months.
    const db = privilegedClient('operator');
    const { data: existing } = await db
      .from('upgrade_requests')
      .select('account_id, reason, status, requested_by_name')
      .eq('id', id)
      .maybeSingle();

    if (!existing) return NextResponse.json({ error: 'No such request' }, { status: 404 });
    if (existing.status !== 'open') {
      return NextResponse.json({ error: 'That request is already closed' }, { status: 409 });
    }

    await resolveUpgradeRequest(id, status);

    await recordOperatorAction({
      operator,
      action: status === 'done' ? 'upgrade.done' : 'upgrade.declined',
      targetAccountId: existing.account_id as string,
      detail: {
        reason: existing.reason ?? null,
        requested_by: existing.requested_by_name ?? null,
      },
      ip: request.headers.get('x-forwarded-for'),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error resolving an upgrade request:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
