import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Where an emailed link comes back to.
 *
 * This did not exist. Confirming a signup, or following a password-reset
 * link, dropped the visitor on a page that never looked at the token —
 * so the session was silently never established, and a refresh showed the
 * sign-in screen as though nothing had happened. forgot-password has been
 * pointing at this exact path all along.
 *
 * Supabase can come back two ways and both have to work:
 *
 *   ?code=…  — the PKCE flow, which is what @supabase/ssr uses. The code
 *     is exchanged HERE, server side, so the session lands in cookies the
 *     middleware and every server component can read. This is the good
 *     path.
 *
 *   #access_token=… — the older implicit flow, still used by links that
 *     were already sent and by admin-generated ones. A fragment never
 *     reaches the server at all, so it cannot be handled here. It is
 *     handed to /auth/complete, which reads it in the browser — and
 *     crucially, browsers PRESERVE the fragment across a redirect, so it
 *     survives the hop.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');

  // A link that has already been used, or a tampered one. Say so on the
  // sign-in page rather than showing a blank success.
  const errorDescription = url.searchParams.get('error_description');
  if (errorDescription) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorDescription)}`, url.origin)
    );
  }

  if (!code) {
    // Either an implicit-flow link (token in the fragment) or someone
    // wandering in. /auth/complete decides, in the browser, where the
    // fragment can actually be read.
    const target = new URL('/auth/complete', url.origin);
    if (next) target.searchParams.set('next', next);
    return NextResponse.redirect(target);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(error?.message ?? 'That link is no longer valid')}`,
        url.origin
      )
    );
  }

  // An explicit destination wins — password reset sends people to a
  // specific page. Only relative paths: an absolute one would let a
  // crafted link bounce someone off our domain carrying a live session.
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return NextResponse.redirect(new URL(next, url.origin));
  }

  // A recovery link ends at the password form, whatever else is true:
  // its whole purpose is to let somebody who cannot sign in choose a new
  // password, and dropping them on the dashboard instead leaves them
  // signed in with the password they had forgotten.
  if (url.searchParams.get('type') === 'recovery') {
    return NextResponse.redirect(new URL('/reset-password', url.origin));
  }

  // Otherwise, their own workspace. Resolved from the session that was
  // just established, never from anything in the link.
  const { data: profile } = await supabase
    .from('profiles')
    .select('account:accounts(slug)')
    .eq('user_id', data.session.user.id)
    .maybeSingle();

  const account = Array.isArray(profile?.account) ? profile?.account[0] : profile?.account;
  const slug = (account as { slug?: string } | undefined)?.slug;

  return NextResponse.redirect(new URL(slug ? `/${slug}/dashboard` : '/', url.origin));
}
