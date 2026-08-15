import { Suspense } from 'react';

import { listPublicPlans } from '@/lib/billing/public-plans';
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

  // useSearchParams inside the form opts it out of static prerendering
  // unless wrapped in Suspense — same pattern as /login.
  return (
    <Suspense fallback={null}>
      <SignupForm plans={plans} />
    </Suspense>
  );
}
