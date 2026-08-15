import { createClient } from '@/lib/supabase/server';

/**
 * The price list, as a visitor sees it.
 *
 * Reads the `public_plans` view (migration 072), not `billing_plans` —
 * the table is operator-only and stays that way. The view publishes an
 * explicit set of columns and excludes retired plans, so nobody can sign
 * up onto a price that is no longer offered.
 *
 * Read with the ordinary anon-capable client rather than the privileged
 * one: this genuinely is public data, and reaching for the service role
 * here would put a signup page behind the key that bypasses every policy
 * in the database.
 */
export interface PublicPlan {
  id: string;
  name: string;
  /** Written by you in the console. Null renders as just a name and a price. */
  description: string | null;
  amountMinor: number;
  currency: string;
  interval: 'month' | 'year';
  /** The one plan a pricing page should draw attention to, if any. */
  highlight: boolean;
}

export async function listPublicPlans(): Promise<PublicPlan[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('public_plans')
      .select('id, name, description, amount_minor, currency, interval, highlight');

    // A signup page must not fail because the price list did. Someone
    // trying to give us money should get a form, not an error page.
    if (error) return [];

    return ((data ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      description: (p.description as string) ?? null,
      amountMinor: Number(p.amount_minor ?? 0),
      currency: p.currency as string,
      interval: (p.interval as 'month' | 'year') ?? 'month',
      highlight: p.highlight === true,
    }));
  } catch {
    return [];
  }
}
