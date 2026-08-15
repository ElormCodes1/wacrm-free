'use client';

import Link from 'next/link';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import {
  companyPath,
  type CompanyRoute,
  type CompanyPathOptions,
} from '@/lib/tenancy/routes';

/**
 * The company whose area the UI is currently rendering.
 *
 * Provided once by the company layout so that no component has to thread
 * a slug through its props — threading is exactly how a link ends up
 * without one, since the prop gets forgotten at the first component that
 * "doesn't need it".
 */
const CompanySlugContext = createContext<string | null>(null);

export function CompanySlugProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  return <CompanySlugContext.Provider value={slug}>{children}</CompanySlugContext.Provider>;
}

/**
 * The current company's slug.
 *
 * Throws rather than returning null: a component inside a company area
 * that cannot find its company is a bug, and surfacing it in development
 * is far cheaper than emitting links that 404 for customers.
 */
export function useCompanySlug(): string {
  const slug = useContext(CompanySlugContext);
  if (!slug) {
    throw new Error(
      'useCompanySlug used outside a company area. Wrap the tree in <CompanySlugProvider>.'
    );
  }
  return slug;
}

type CompanyLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & {
  to: CompanyRoute;
} & CompanyPathOptions;

/**
 * The only link component permitted inside a company's area.
 *
 * It takes a route from a closed union — never an href — and reads the
 * company from context, so producing a link that drops the company is not
 * something a caller can do wrong. `next/link` and raw `href` strings are
 * banned in these directories by lint, which closes the escape hatch.
 */
export function CompanyLink({ to, segments, query, hash, ...rest }: CompanyLinkProps) {
  const slug = useCompanySlug();
  return <Link href={companyPath(slug, to, { segments, query, hash })} {...rest} />;
}

/**
 * Imperative navigation inside a company area, for handlers that cannot
 * use a link (a form submit, a redirect after saving).
 */
export function useCompanyPath() {
  const slug = useCompanySlug();
  return (route: CompanyRoute, options?: CompanyPathOptions) =>
    companyPath(slug, route, options);
}

type CompanyLinkForProps = Omit<ComponentProps<typeof Link>, 'href'> & {
  /** The company, passed explicitly. */
  company: string;
  to: CompanyRoute;
} & CompanyPathOptions;

/**
 * The server-component variant.
 *
 * Server components cannot read context, so the company is passed
 * explicitly — from `params.company`, which the route segment guarantees
 * is present. It is still impossible to omit: `company` is required, so
 * forgetting it is a type error rather than a link that 404s on click.
 */
export function CompanyLinkFor({
  company,
  to,
  segments,
  query,
  hash,
  ...rest
}: CompanyLinkForProps) {
  return <Link href={companyPath(company, to, { segments, query, hash })} {...rest} />;
}
