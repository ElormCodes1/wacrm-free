import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "./dashboard-shell";
import { getCompany } from "@/lib/tenancy/company";

// Every dashboard route is authenticated and per-user (it renders the
// caller's own data, scoped by their cookie session), so none of it may be
// statically prerendered at build time — always render per request. This
// also matters now that the shell renders `{children}` immediately (it used
// to short-circuit to a spinner, which accidentally shielded these client
// pages from build-time prerendering).
export const dynamic = "force-dynamic";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

/**
 * Requires a session.
 *
 * This gate lives here rather than in the company layout above, because
 * that one also wraps the front door and the branded sign-in — pages whose
 * whole purpose is to work without a session. Everything in THIS group is
 * the authenticated app, so the requirement applies to the group rather
 * than to a hand-kept list of page names, which is the shape that lets one
 * new page through unnoticed.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ company: string }>;
}) {
  const { company } = await params;
  const result = await getCompany();
  if (!result.ok) {
    // Back to this company's own branded sign-in, not a generic one.
    redirect(`/login?company=${encodeURIComponent(company)}`);
  }
  return <DashboardShell>{children}</DashboardShell>;
}
