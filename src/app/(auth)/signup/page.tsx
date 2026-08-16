import { Suspense } from 'react';
import { headers } from 'next/headers';

import { listPublicPlans } from '@/lib/billing/public-plans';
import { configuredOrigin, normaliseOrigin } from '@/lib/app-url';
import { SignupForm } from './signup-form';

/**
 * Signup.
 *
 * The plans are fetched HERE, on the server, rather than after hydration.
 * A client fetch would render the form, then push it down as the prices
 * arrived — a layout shift under someone's cursor while they are filling
 * in a form, and on the one page where a shift can cause a mis-click that
 * costs a signup.
 *
 * When no plans exist the picker simply is not rendered, and this page is
 * exactly what it was before. That is the state the app ships in.
 */
export default async function SignupPage() {
  const plans = await listPublicPlans();

  // The confirmation email carries this address, so it must not come from
  // the browser: Next advertises itself as http://0.0.0.0:3000 and a link
  // to a bind address is one nobody can follow.
  const configured = configuredOrigin();
  let appOrigin = configured;
  if (!appOrigin) {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const proto = h.get('x-forwarded-proto') ?? 'https';
    appOrigin = host ? normaliseOrigin(`${proto}://${host}`) : null;
  }

  // useSearchParams inside the form opts it out of static prerendering
  // unless wrapped in Suspense — same pattern as /login.
  return (
    <Suspense fallback={null}>
      <SignupForm plans={plans} appOrigin={appOrigin} />
    </Suspense>
  );
}
