import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * A company's public face: what a sign-in page shows before anyone has
 * proved who they are.
 *
 * Read through the anon key against a view that exposes only name, logo,
 * colour and status — never membership, counts, or anything about the
 * company's data. It has to work unauthenticated, because the whole point
 * is that someone standing at a door can tell whose system this is
 * without logging in first.
 *
 * A suspended company is returned rather than hidden: the address must be
 * able to say what happened. Returning null for it would render as
 * "unknown company", which is a different and misleading answer.
 */
export interface CompanyBranding {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  status: 'active' | 'suspended';
}

export async function companyBrandingBySlug(
  slug: string
): Promise<CompanyBranding | null> {
  if (!slug) return null;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await supabase
    .from('public_company_branding')
    .select('slug, name, logo_url, brand_color, status')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();

  if (!data) return null;
  return {
    slug: data.slug as string,
    name: data.name as string,
    logoUrl: (data.logo_url as string | null) ?? null,
    brandColor: (data.brand_color as string | null) ?? null,
    status: data.status as 'active' | 'suspended',
  };
}
