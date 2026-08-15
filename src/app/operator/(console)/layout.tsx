import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

import { getOperator } from '@/lib/operator/session';
import { BrandLogo } from '@/components/layout/brand-logo';
import { OperatorNav, OperatorSignOut } from './nav';

/**
 * The console shell.
 *
 * Checks only the operator session. A customer session — of any role, in
 * any company — is not consulted and cannot substitute, which is what
 * makes "no escalation from a customer session" true rather than
 * intended.
 *
 * It lives in a (console) route group rather than directly under
 * /operator, and that is load-bearing. When it sat at /operator it also
 * wrapped /operator/login — so the sign-in page was guarded by a rule
 * that redirects to the sign-in page, and it redirected to itself
 * forever. The operator plane was unreachable through a browser for as
 * long as it existed; every session was minted by POSTing to the API
 * directly, which is exactly the path a real person never takes.
 *
 * The group adds no URL segment, so /operator, /operator/companies and
 * /operator/c/<slug> are unchanged, while /operator/login now sits
 * outside the guard where it belongs.
 *
 * The amber strip is not decoration. Every page below shows other
 * people's businesses, and the console is close enough in look to the
 * product that it would otherwise be easy to forget whose data is on
 * screen.
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const operator = await getOperator();
  if (!operator) redirect('/operator/login');

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-center text-xs text-amber-700 dark:text-amber-400">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        Operator console — you are looking at customer data. Every action is recorded.
      </div>

      <div className="flex min-h-[calc(100vh-1.9rem)]">
        {/* ---------- sidebar ---------- */}
        <aside className="border-border bg-card hidden w-56 shrink-0 flex-col border-r md:flex">
          <div className="border-border flex h-14 items-center gap-2.5 border-b px-4">
            <BrandLogo className="h-6 w-6" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">WaCRM</p>
              <p className="text-muted-foreground -mt-0.5 text-[11px]">Operator</p>
            </div>
          </div>

          <div className="flex-1 p-2">
            <OperatorNav />
          </div>

          <div className="border-border border-t p-3">
            <OperatorSignOut name={operator.name} />
          </div>
        </aside>

        {/* ---------- main ---------- */}
        <div className="min-w-0 flex-1">
          {/* Narrow screens get the nav as a strip rather than nothing:
              this is a desk tool, but being locked out of half of it on a
              phone during an incident is worse than a compromise. */}
          <div className="border-border bg-card flex items-center gap-1 border-b px-4 py-2 md:hidden">
            <Link href="/operator" className="mr-2 flex items-center gap-2">
              <BrandLogo className="h-5 w-5" />
              <span className="text-sm font-semibold">Operator</span>
            </Link>
            <div className="flex-1" />
            <OperatorNav />
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
