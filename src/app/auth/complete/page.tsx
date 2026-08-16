import { Suspense } from 'react';

import { CompleteSignIn } from './complete-sign-in';

/**
 * The half of the email-link flow that can only happen in a browser.
 *
 * Older Supabase links return the tokens in the URL FRAGMENT
 * (#access_token=…), and a fragment is never sent to a server — so no
 * route handler, middleware or server component can see it. Something has
 * to read it in the browser and hand it to the Supabase client, which is
 * all this page does.
 *
 * Before this existed the landing page was where those links arrived, and
 * it creates no Supabase client at all — so the token sat in the address
 * bar doing nothing, and the visitor appeared to be signed out the moment
 * they reloaded.
 */
export default function AuthCompletePage() {
  return (
    <Suspense fallback={null}>
      <CompleteSignIn />
    </Suspense>
  );
}
