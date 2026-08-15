import { NextResponse } from 'next/server';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { privilegedClient } from '@/lib/supabase/privileged';
import { setCompanyBilling, listPlans } from '@/lib/operator/billing';
import { parseAmountToMinor } from '@/lib/billing/money';

/**
 * Put a company on a plan, or change what it is on.
 *
 * Everything is optional and only what is sent is written, so changing
 * the renewal date does not silently clear the negotiated price. The
 * previous values are recorded in the audit detail alongside the new
 * ones — "who moved this customer onto the cheaper plan, and what were
 * they on before" is the question that gets asked, and a record of only
 * the new value cannot answer it.
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
      planId?: string | null;
      status?: string;
      amount?: string;
      currency?: string;
      periodEnd?: string | null;
      trialEndsAt?: string | null;
      notes?: string | null;
    };

    const db = privilegedClient('operator');
    const { data: account } = await db
      .from('accounts')
      .select('id, name, default_currency')
      .eq('slug', slug)
      .maybeSingle();
    if (!account) {
      return NextResponse.json({ error: 'No company at that address' }, { status: 404 });
    }
    const accountId = account.id as string;

    const { data: before } = await db
      .from('account_billing')
      .select('plan_id, status, amount_minor, currency, period_end')
      .eq('account_id', accountId)
      .maybeSingle();

    const update: Parameters<typeof setCompanyBilling>[1] = {};

    if (body.planId !== undefined) {
      if (body.planId) {
        const plans = await listPlans(true);
        const plan = plans.find((p) => p.id === body.planId);
        if (!plan) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
        update.planId = plan.id;
        // Adopt the plan's currency unless one is being set explicitly.
        // A price in one currency against a plan in another is the kind of
        // mismatch that only shows up on an invoice.
        if (body.currency === undefined) update.currency = plan.currency;
      } else {
        update.planId = null;
      }
    }

    if (body.status !== undefined) {
      if (!['trialing', 'active', 'canceled'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      update.status = body.status as 'trialing' | 'active' | 'canceled';
    }

    if (body.currency !== undefined && body.currency !== null) {
      const cur = body.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(cur)) {
        return NextResponse.json({ error: 'Currency must be a 3-letter code' }, { status: 400 });
      }
      update.currency = cur;
    }

    if (body.amount !== undefined) {
      const trimmed = (body.amount ?? '').trim();
      if (trimmed === '') {
        // Explicitly clearing the override means "use the plan's price".
        update.amountMinor = null;
      } else {
        const currency =
          update.currency ??
          (before?.currency as string) ??
          (account.default_currency as string) ??
          'USD';
        const parsed = parseAmountToMinor(trimmed, currency);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
        update.amountMinor = parsed.minor;
      }
    }

    if (body.periodEnd !== undefined) update.periodEnd = body.periodEnd || null;
    if (body.trialEndsAt !== undefined) update.trialEndsAt = body.trialEndsAt || null;
    if (body.notes !== undefined) update.notes = body.notes || null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
    }

    const result = await setCompanyBilling(accountId, update);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

    await recordOperatorAction({
      operator,
      action: 'billing.update',
      targetAccountId: accountId,
      detail: { slug, before: before ?? null, after: update },
      ip: request.headers.get('x-forwarded-for'),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error updating billing:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
