import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The only way to obtain a client that bypasses row-level security.
 *
 * Everything else in the app talks to Supabase as the signed-in user, so
 * RLS decides what is visible and a query that forgets to filter by
 * company simply returns nothing. That is what makes ~480 unconstrained
 * queries safe rather than 480 latent leaks.
 *
 * A service-role client removes that guarantee completely: it sees every
 * company's rows, and a missing filter there is a real cross-tenant leak.
 * So it is deliberately awkward to obtain — one module, an explicit reason,
 * and an ESLint rule that stops anyone reading the key anywhere else.
 *
 * If you are reaching for this to "just get the data", you want the normal
 * client. The legitimate uses are narrow: requests that arrive with no user
 * session at all (an inbound webhook), and background work that spans
 * companies by design (a cron sweep). Both are listed below, so adding a
 * new one is a visible decision rather than an import.
 */

/**
 * Why a caller needs to bypass RLS. Adding a member here is the moment to
 * ask whether the work could be done as the user instead — the answer is
 * usually yes.
 */
export type PrivilegedReason =
  /** Inbound provider webhook: no session exists, the payload is the auth. */
  | 'inbound-webhook'
  /** Scheduled/system sweep that spans companies by design. */
  | 'system-maintenance'
  /** Background engine acting for a company resolved from stored config. */
  | 'background-engine'
  /** Operator plane: cross-company by definition, and audited separately. */
  | 'operator';

/**
 * A Supabase client with the service role.
 *
 * @param reason why RLS is being bypassed — recorded at the call site so
 *   a reader can judge it without tracing the whole request.
 * @param accountId the company this work is for, when it is known. Passing
 *   it does not filter anything by itself; it exists so that a caller who
 *   knows the company is nudged to constrain by it, and so future auditing
 *   can tell "acting for one company" from "spanning all of them".
 */
export function privilegedClient(
  reason: PrivilegedReason,
  accountId?: string
): SupabaseClient {
  void reason;
  void accountId;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'privilegedClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
