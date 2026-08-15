import { cookies } from 'next/headers';

import { companyBrandingBySlug } from '@/lib/tenancy/branding';
import { sanitiseCompanyHint, LAST_COMPANY_COOKIE } from '@/lib/tenancy/last-company';
import { LoginForm, type Branding } from './login-form';

/**
 * The sign-in page, branded for whichever company the visitor belongs to.
 *
 * The branding is resolved HERE, on the server, rather than fetched after
 * hydration. A client fetch would paint the generic product logo first and
 * swap it a moment later, which defeats the purpose: the point is that
 * someone can tell whose system they are looking at before they type a
 * password, and a flash of the wrong identity is exactly the doubt this is
 * meant to remove.
 *
 * Which company to paint comes from the address, then from the cookie left
 * by the last successful sign-in on this device. Both are sanitised and
 * both are hints only — the worst a tampered value achieves is showing
 * someone the wrong company's logo above a form that still demands their
 * password. Nothing is granted by it, so nothing about it is worth
 * stealing.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company } = await searchParams;
  const store = await cookies();

  const hint =
    sanitiseCompanyHint(company) ??
    sanitiseCompanyHint(store.get(LAST_COMPANY_COOKIE)?.value);

  let branding: Branding | null = null;
  if (hint) {
    const found = await companyBrandingBySlug(hint);
    // A suspended company still gets its own sign-in page: the person
    // needs to reach someone who can explain, not a blank wall.
    if (found) {
      branding = {
        slug: found.slug,
        name: found.name,
        logoUrl: found.logoUrl,
        brandColor: found.brandColor,
        status: found.status,
      };
    }
  }

  return <LoginForm branding={branding} />;
}
