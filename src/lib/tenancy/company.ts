import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { AccountRole } from '@/lib/auth/roles';

/**
 * The one place that answers "which company is this request for".
 *
 * The answer comes from the SESSION — the signed-in user's profile — and
 * never from anything the browser supplied. Not the address, not a form
 * field, not a header. A slug in the URL is presentation: it decides what
 * branding to paint and whether to bounce someone somewhere else, and it
 * is never consulted to decide which rows to read.
 *
 * That distinction is the whole design. If the company came from the URL,
 * every route would have to be trusted to validate it, and one that forgot
 * would read another company's data with a perfectly ordinary-looking
 * query. Taking it from the session means a forgetful route gets the
 * caller's own company by construction, and RLS refuses the rest.
 *
 * `server-only` is imported for effect: it makes this module a build error
 * if it is ever pulled into a client bundle, where the session could be
 * tampered with.
 */

export interface CompanyContext {
  /** Account id. The value every tenant-owned row is keyed by. */
  id: string;
  /** Public, printable address segment. Immutable once issued. */
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  logoUrl: string | null;
  brandColor: string | null;
  /** The signed-in person's role within this company. */
  role: AccountRole;
  userId: string;
}

/** Why a request has no usable company, so callers can respond precisely. */
export type CompanyFailure =
  | { reason: 'unauthenticated' }
  | { reason: 'no-company' }
  | { reason: 'suspended'; slug: string; name: string }
  | { reason: 'deactivated' };

export type CompanyResult =
  | { ok: true; company: CompanyContext }
  | { ok: false; failure: CompanyFailure };

/**
 * Resolve the company for the current request from the session.
 *
 * Reads through the caller's own Supabase client, so RLS applies to the
 * lookup too — this cannot be used to read a company the caller isn't in.
 */
export async function getCompany(): Promise<CompanyResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { ok: false, failure: { reason: 'unauthenticated' } };

  // profiles is the membership record; accounts carries identity and
  // lifecycle. One join rather than two round trips, and both are behind
  // the same RLS the rest of the app uses.
  const { data } = await supabase
    .from('profiles')
    .select(
      'account_id, account_role, is_active, account:accounts(id, slug, name, status, logo_url, brand_color)'
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data?.account_id) return { ok: false, failure: { reason: 'no-company' } };
  if (data.is_active === false) return { ok: false, failure: { reason: 'deactivated' } };

  const account = (Array.isArray(data.account) ? data.account[0] : data.account) as
    | {
        id: string;
        slug: string | null;
        name: string;
        status: 'active' | 'suspended';
        logo_url: string | null;
        brand_color: string | null;
      }
    | undefined;

  if (!account?.slug) return { ok: false, failure: { reason: 'no-company' } };
  if (account.status === 'suspended') {
    return {
      ok: false,
      failure: { reason: 'suspended', slug: account.slug, name: account.name },
    };
  }

  return {
    ok: true,
    company: {
      id: account.id,
      slug: account.slug,
      name: account.name,
      status: account.status,
      logoUrl: account.logo_url,
      brandColor: account.brand_color,
      role: (data.account_role ?? 'viewer') as AccountRole,
      userId: user.id,
    },
  };
}

/**
 * The company for this request, or throw.
 *
 * For routes that cannot meaningfully continue without one. Callers that
 * want to render something specific for each failure should use
 * `getCompany` and switch on the reason.
 */
export async function requireCompany(): Promise<CompanyContext> {
  const result = await getCompany();
  if (!result.ok) {
    throw new Error(`No company for this request: ${result.failure.reason}`);
  }
  return result.company;
}

/**
 * What to do when the address names a different company than the session.
 *
 * Someone typing another company's address is almost always confused
 * rather than attacking — a bookmark from a previous employer, a link
 * pasted in a group chat — so they are sent to their own company rather
 * than shown an error they can do nothing about. Nothing of the other
 * company is rendered on the way past.
 */
export function resolveSlugMismatch(
  urlSlug: string,
  company: CompanyContext,
  currentPath: string
): string | null {
  if (urlSlug === company.slug) return null;
  // Keep them on the page they asked for, under their own company.
  const rest = currentPath.replace(new RegExp(`^/${escapeSegment(urlSlug)}`), '');
  return `/${company.slug}${rest || ''}`;
}

function escapeSegment(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
