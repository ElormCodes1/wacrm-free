'use client';

import { useEffect } from 'react';

/**
 * Rescues an emailed sign-in that landed on the wrong page.
 *
 * Supabase sends people to its configured Site URL unless the specific
 * redirect is allow-listed in the project — and the Site URL here is the
 * landing page, which creates no Supabase client. So a confirmation link
 * arrived with #access_token=… in the address bar and absolutely nothing
 * read it: no session, and a reload showed the sign-in screen as though
 * the click had never happened.
 *
 * This notices that fragment and forwards to /auth/complete, which knows
 * what to do with it. Two things make it safe to mount on a public page:
 * it does nothing at all unless an auth token is present, and it pulls in
 * no Supabase client of its own.
 *
 * The right long-term fix is allow-listing /auth/callback in Supabase so
 * links come back through the PKCE route instead. This is what makes the
 * links that have ALREADY been sent work, and what stops the flow
 * depending on a dashboard setting nobody can see from the code.
 */
export function AuthFragmentCatcher() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const hasToken = params.has('access_token') && params.has('refresh_token');
    const hasError = params.has('error_description');
    if (!hasToken && !hasError) return;

    // Carry the fragment across verbatim — it is the whole payload, and
    // it never touches the network on the way.
    window.location.replace(`/auth/complete${hash}`);
  }, []);

  return null;
}
