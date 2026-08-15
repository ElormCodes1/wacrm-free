import { NextResponse } from 'next/server';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { privilegedClient } from '@/lib/supabase/privileged';
import {
  recordPayment,
  setCompanyBilling,
  nextPeriodEnd,
  getCompanyBilling,
} from '@/lib/operator/billing';
import { parseAmountToMinor } from '@/lib/billing/money';

/**
 * Record that money arrived, and optionally mark the customer paid up.
 *
 * These are two separate facts and the endpoint treats them that way. A
 * payment row says money was received and is never rewritten; extending
 * the period is a decision about what that money bought, which is usually
 * "one more interval" but is not always — a part payment, a refund of a
 * duplicate, or money against arrears should not move the renewal date.
 * Hence `extendPeriod`, defaulting to true because that is the common
 * case, but never implicit.
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
      amount?: string;
      currency?: string;
      paidAt?: string;
      method?: string;
      reference?: string;
      note?: string;
      extendPeriod?: boolean;
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

    const existing = await getCompanyBilling(accountId);

    const currency = (
      body.currency ??
      existing.currency ??
      (account.default_currency as string) ??
      'USD'
    )
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json({ error: 'Currency must be a 3-letter code' }, { status: 400 });
    }

    const parsed = parseAmountToMinor(body.amount ?? '', currency);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (parsed.minor === 0) {
      return NextResponse.json({ error: 'A payment cannot be zero' }, { status: 400 });
    }

    const recorded = await recordPayment({
      accountId,
      amountMinor: parsed.minor,
      currency,
      paidAt: body.paidAt || undefined,
      method: body.method?.trim() || null,
      reference: body.reference?.trim() || null,
      note: body.note?.trim() || null,
      recordedBy: operator.userId,
      recordedByName: operator.name,
    });
    if (!recorded.ok) {
      return NextResponse.json({ error: recorded.error }, { status: 500 });
    }

    let newPeriodEnd: string | null = null;
    const extend = body.extendPeriod !== false;

    if (extend) {
      const interval = existing.planInterval ?? 'month';
      newPeriodEnd = nextPeriodEnd(existing.periodEnd, interval);
      // A payment also ends a trial: they are a paying customer now, and
      // leaving the status on "trialing" would keep them out of revenue.
      await setCompanyBilling(accountId, {
        periodEnd: newPeriodEnd,
        status: existing.status === 'canceled' ? 'active' : 'active',
        periodStart: existing.periodStart ?? new Date().toISOString(),
      });
    }

    await recordOperatorAction({
      operator,
      action: 'billing.payment',
      targetAccountId: accountId,
      detail: {
        slug,
        amount_minor: parsed.minor,
        currency,
        reference: body.reference ?? null,
        extended_to: newPeriodEnd,
      },
      ip: request.headers.get('x-forwarded-for'),
    });

    return NextResponse.json({ ok: true, paidUntil: newPeriodEnd });
  } catch (error) {
    console.error('Error recording a payment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
