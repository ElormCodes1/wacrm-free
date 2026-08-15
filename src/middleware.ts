import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * First path segments the app serves itself. Anything else in that
 * position is a company address.
 *
 * 'operator' has to be here even though the operator plane guards itself:
 * without it, /operator/audit reads as the company "operator" and gets
 * redirected to the CUSTOMER sign-in — so the operator console appears to
 * demand a customer session it never uses. /operator alone was fine (one
 * segment) and /operator/login was fine (the login exception), which is
 * why the gap only showed once the console grew a second page.
 */
const TOP_LEVEL_ROUTES = new Set([
  'api',
  'join',
  'login',
  'signup',
  'forgot-password',
  'operator',
])

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated.
  //
  // Previously a hand-kept list of page names, with a comment admitting
  // that an omission lets an unauthenticated visitor render the page. That
  // list also went silently dead the moment every route moved under
  // /{company}/..., because it matched on a leading "/inbox" that no
  // longer exists — the failure it warned about, arriving by a route
  // nobody predicted.
  //
  // The rule is now structural: anything with a company segment in front
  // of it is the authenticated app, EXCEPT the front door and the branded
  // sign-in, which exist precisely to be readable without a session. New
  // pages are covered the day they are added, without anyone updating
  // anything.
  const segments = request.nextUrl.pathname.split('/').filter(Boolean)
  const looksLikeCompanyPage =
    segments.length >= 2 &&
    !TOP_LEVEL_ROUTES.has(segments[0]) &&
    segments[1] !== 'login'

  if (!user && looksLikeCompanyPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('company', segments[0])
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth. Two exceptions, both of which authenticate
  // themselves: the inbound webhook (shared secret) and the socket health
  // check (bearer token, so a cron with no session can run it).
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook') &&
      !request.nextUrl.pathname.includes('/health') &&
      !request.nextUrl.pathname.includes('/reconcile')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
