import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getOperator } from '@/lib/operator/session';

/**
 * Guards everything in the operator plane.
 *
 * Checks only the operator session. A customer session — of any role, in
 * any company — is not consulted and cannot substitute, which is what
 * makes "no escalation from a customer session" true rather than
 * intended.
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const operator = await getOperator();
  if (!operator) redirect('/operator/login');
  return <>{children}</>;
}
