/**
 * Every address inside a company's area, and the only way to build one.
 *
 * A link that drops the company is the failure mode this whole module
 * exists to prevent, because it fails silently: `/inbox` is a perfectly
 * valid-looking address, the page around it renders fine, and it only
 * breaks when somebody clicks — which in testing is nobody, and on a bad
 * day is everybody. Worse, the ones that break are usually inside a
 * condition ("if the count is above zero"), so they are exactly the links
 * a walkthrough never exercises.
 *
 * The defence is to make the bad link impossible to express rather than
 * something to remember:
 *
 *   1. `companyPath` REQUIRES the company as its first argument, and the
 *      route as a value from a closed union. There is no overload that
 *      omits either, so a company-less link cannot be produced by calling
 *      it — TypeScript rejects it at build time.
 *   2. `<CompanyLink>` takes the same shape and is the only link component
 *      allowed inside a company area.
 *   3. An ESLint rule bans `next/link` and raw string `href`s in those
 *      directories, so the escape hatch is closed too. That runs in CI,
 *      which is before a browser ever sees it.
 *
 * Adding a page means adding it to COMPANY_ROUTES; a typo there is a type
 * error rather than a 404 discovered by a customer.
 */

export const COMPANY_ROUTES = [
  'dashboard',
  'inbox',
  'contacts',
  'pipelines',
  'tasks',
  'broadcasts',
  'automations',
  'flows',
  'channels',
  'communities',
  'store',
  'status',
  'agents',
  'notifications',
  'settings',
  'login',
] as const;

export type CompanyRoute = (typeof COMPANY_ROUTES)[number];

/** A company's slug. Named so a bare string is harder to pass by accident. */
export type CompanySlug = string & { readonly __companySlug?: unique symbol };

export interface CompanyPathOptions {
  /** Extra path below the route, e.g. ['new'] or [broadcastId, 'edit']. */
  segments?: (string | number)[];
  /** Query parameters. Undefined and null values are dropped. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Fragment, without the leading '#'. */
  hash?: string;
}

/**
 * Build an address inside a company's area.
 *
 * The company is the first parameter and is not optional — that single
 * decision is what makes the silent failure unrepresentable, since there
 * is no way to call this and get a company-less path back.
 */
export function companyPath(
  company: CompanySlug,
  route: CompanyRoute,
  options: CompanyPathOptions = {}
): string {
  if (!company) {
    // Defence in depth: types stop this at build time, but a value can
    // still arrive empty from untyped data at runtime. Failing loudly
    // beats emitting `//inbox`, which looks plausible and 404s later.
    throw new Error(
      `companyPath called without a company (route: ${route}). ` +
        'Every link inside a company area must carry its company.'
    );
  }

  const parts = [company, route, ...(options.segments ?? []).map(String)]
    .filter((p) => p !== '')
    .map((p) => encodeURIComponent(p));

  let path = `/${parts.join('/')}`;

  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) path += `?${qs}`;
  }

  if (options.hash) path += `#${options.hash}`;
  return path;
}

/** True when a first path segment is a known app page rather than a company. */
export function isReservedFirstSegment(segment: string, reserved: readonly string[]): boolean {
  return reserved.includes(segment.toLowerCase());
}

/**
 * Split an incoming path into its company slug and the rest.
 *
 * Used by middleware to decide whether an address belongs to a company
 * area at all. Deliberately does no validation of the slug itself — that
 * is the database's job, and duplicating the rules here is how the two
 * drift apart.
 */
export function splitCompanyPath(pathname: string): {
  slug: string | null;
  rest: string;
} {
  const trimmed = pathname.replace(/^\/+/, '');
  if (!trimmed) return { slug: null, rest: '/' };
  const [first, ...others] = trimmed.split('/');
  return { slug: first ?? null, rest: `/${others.join('/')}` };
}
