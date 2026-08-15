import { redirect } from 'next/navigation';

import { getCompany } from '@/lib/tenancy/company';
import { companyBrandingBySlug } from '@/lib/tenancy/branding';
import { CompanyUnavailable } from '@/components/tenancy/company-unavailable';
import { CompanyBrandMark } from '@/components/tenancy/company-brand-mark';
import { CompanyLinkFor } from '@/components/tenancy/company-link';
import { companyPath } from '@/lib/tenancy/routes';

/**
 * A company's front door.
 *
 * This is the address that gets printed on a poster and read down a
 * phone, so it has to be useful to someone who has never signed in: it
 * shows whose system this is — name, logo, colour — before asking for
 * anything. Someone standing at a door at 6am can tell they are in the
 * right place without authenticating first.
 *
 * Signed-in members skip straight through to their dashboard; there is
 * nothing to look at here once you are in.
 */
export default async function CompanyHome({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;

  // Public lookup first: this has to work with no session at all.
  const branding = await companyBrandingBySlug(slug);
  if (!branding) return <CompanyUnavailable kind="unknown" slug={slug} />;
  if (branding.status === 'suspended') {
    return <CompanyUnavailable kind="suspended" slug={slug} name={branding.name} />;
  }

  const result = await getCompany();
  if (result.ok && result.company.slug === slug) {
    redirect(companyPath(slug, 'dashboard'));
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <CompanyBrandMark branding={branding} size="lg" />
        <h1 className="text-foreground mt-4 text-2xl font-semibold">{branding.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sign in to continue to your workspace.
        </p>
        <CompanyLinkFor
          company={slug}
          to="login"
          className="bg-primary text-primary-foreground mt-6 inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium transition-opacity hover:opacity-90"
          style={
            branding.brandColor ? { backgroundColor: branding.brandColor } : undefined
          }
        >
          Sign in
        </CompanyLinkFor>
        <p className="text-muted-foreground mt-6 text-xs">
          <code className="font-mono">/{slug}</code>
        </p>
      </div>
    </main>
  );
}
