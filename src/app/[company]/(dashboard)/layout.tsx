import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";

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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}
