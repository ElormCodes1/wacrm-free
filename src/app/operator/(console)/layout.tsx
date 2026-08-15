import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

import { getOperator } from '@/lib/operator/session';
import { OperatorSignOut } from './sign-out';

/**
 * Guards the operator console.
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
 * The group adds no URL segment, so /operator, /operator/audit and
 * /operator/c/<slug> are unchanged, while /operator/login now sits
 * outside the guard where it belongs.
 *
 * The banner is not decoration. Every page below this shows other
 * people's businesses, and the console looks enough like the product that
 * it would otherwise be easy to forget whose data is on screen.
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const operator = await getOperator();
  if (!operator) redirect('/operator/login');

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
        <ShieldAlert className="h-3.5 w-3.5" />
        Operator console — you are looking at customer data. Every action is recorded.
      </div>

      <header className="border-border border-b">
        <nav className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-5 text-sm">
          <Link href="/operator" className="font-semibold">
            Companies
          </Link>
          <Link href="/operator/audit" className="text-muted-foreground hover:text-foreground">
            Audit trail
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted-foreground text-xs">{operator.name}</span>
            <OperatorSignOut />
          </div>
        </nav>
      </header>

      {children}
    </div>
  );
}
