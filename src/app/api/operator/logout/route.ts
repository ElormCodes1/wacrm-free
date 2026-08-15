import { NextResponse } from 'next/server';

import { getOperator, clearOperatorSession, recordOperatorAction } from '@/lib/operator/session';

/**
 * End an operator session.
 *
 * Recorded before the cookie is cleared, because afterwards there is no
 * operator to attribute it to — and a trail that shows sign-ins but never
 * sign-outs makes every session look like it is still open.
 */
export async function POST(request: Request) {
  const operator = await getOperator();
  if (operator) {
    await recordOperatorAction({
      operator,
      action: 'operator.sign-out',
      ip: request.headers.get('x-forwarded-for'),
    });
  }
  await clearOperatorSession();
  return NextResponse.json({ ok: true });
}
