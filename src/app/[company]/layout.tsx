import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getCompany } from '@/lib/tenancy/company';
import { CompanySlugProvider } from '@/components/tenancy/company-link';
import { companyBrandingBySlug } from '@/lib/tenancy/branding';
import { CompanyUnavailable } from '@/components/tenancy/company-unavailable';

/**
 * The gate for everything inside a company's area.
 *
 * Three things happen here, in this order, and the order matters:
 *
 *   1. The company for the request is resolved FROM THE SESSION. The slug
 *      in the address is never used to select data — only to notice a
 *      mismatch. A route below this can therefore be written carelessly
 *      and still only ever see its own company's rows.
 *
 *   2. A mismatch bounces the person to the same page under their own
 *      company. Someone typing another company's address is nearly always
 *      confused rather than attacking — an old bookmark, a link pasted in
 *      a group chat — and an error page they can do nothing about is a
 *      worse answer than quietly putting them where they belong. Nothing
 *      of the other company renders on the way past.
 *
 *   3. An address that names no company, or a suspended one, gets a page
 *      that says so plainly. Never a half-rendered dashboard, which reads
 *      as "the app is broken" instead of "you typed the wrong thing".
 */
export default async function CompanyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ company: string }>;
}) {
  const { company: urlSlug } = await params;
  const result = await getCompany();

  if (!result.ok) {
    const { failure } = result;

    // Not signed in: this layout does NOT bounce to sign-in. The front
    // door and the branded sign-in page live under here and have to render
    // without a session — that is the whole point of a printable address.
    // Requiring a session is the dashboard group's job, one level down.
    if (failure.reason === 'unauthenticated') {
      const branding = await companyBrandingBySlug(urlSlug);
      if (!branding) return <CompanyUnavailable kind="unknown" slug={urlSlug} />;
      if (branding.status === 'suspended') {
        return <CompanyUnavailable kind="suspended" slug={urlSlug} name={branding.name} />;
      }
      return <CompanySlugProvider slug={urlSlug}>{children}</CompanySlugProvider>;
    }

    if (failure.reason === 'suspended') {
      return <CompanyUnavailable kind="suspended" slug={failure.slug} name={failure.name} />;
    }
    if (failure.reason === 'deactivated') {
      return <CompanyUnavailable kind="deactivated" slug={urlSlug} />;
    }
    // Signed in but attached to no company — nothing sensible to render.
    redirect('/login');
  }

  const { company } = result;

  if (urlSlug !== company.slug) {
    // Bounce, don't explain. See (2) above.
    redirect(`/${company.slug}`);
  }

  return <CompanySlugProvider slug={company.slug}>{children}</CompanySlugProvider>;
}
