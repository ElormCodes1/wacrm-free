import { NextResponse } from 'next/server';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { createPlan, setPlanActive, listPlans } from '@/lib/operator/billing';
import { parseAmountToMinor } from '@/lib/billing/money';

/**
 * Create a plan, or retire one.
 *
 * The amount arrives as typed — "48.50" — and is converted here rather
 * than in the browser, because the server is the only place that can be
 * relied on to have done it. Rejecting an over-precise amount instead of
 * rounding it is deliberate: rounding bills a figure nobody agreed to.
 */
export async function POST(request: Request) {
  const operator = await getOperator();
  if (!operator) {
    return NextResponse.json({ error: 'Not signed in as an operator' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    id?: string;
    isActive?: boolean;
    name?: string;
    amount?: string;
    currency?: string;
    interval?: string;
  };

  if (body.action === 'retire' || body.action === 'restore') {
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const isActive = body.action === 'restore';
    await setPlanActive(body.id, isActive);
    await recordOperatorAction({
      operator,
      action: isActive ? 'plan.restore' : 'plan.retire',
      detail: { planId: body.id },
      ip: request.headers.get('x-forwarded-for'),
    });
    return NextResponse.json({ ok: true });
  }

  const name = (body.name ?? '').trim();
  const currency = (body.currency ?? '').trim().toUpperCase();
  const interval = body.interval === 'year' ? 'year' : 'month';

  if (!name) return NextResponse.json({ error: 'Give the plan a name' }, { status: 400 });
  if (!/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json({ error: 'Currency must be a 3-letter code' }, { status: 400 });
  }

  const parsed = parseAmountToMinor(body.amount ?? '', currency);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await createPlan({
    name,
    amountMinor: parsed.minor,
    currency,
    interval,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await recordOperatorAction({
    operator,
    action: 'plan.create',
    detail: { name, amount_minor: parsed.minor, currency, interval },
    ip: request.headers.get('x-forwarded-for'),
  });

  return NextResponse.json({ ok: true, id: result.id });
}

export async function GET() {
  const operator = await getOperator();
  if (!operator) {
    return NextResponse.json({ error: 'Not signed in as an operator' }, { status: 401 });
  }
  return NextResponse.json({ plans: await listPlans(true) });
}
