import { headers } from 'next/headers';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { privilegedClient } from '@/lib/supabase/privileged';

/**
 * The operator console: every company, across tenants.
 *
 * Viewing this list is itself an operator action and is recorded before
 * the data is rendered — a read that crosses company lines is exactly
 * what the trail exists to capture, and recording it afterwards would
 * miss the ones that fail halfway.
 */
export default async function OperatorHome() {
  const operator = await getOperator();
  if (!operator) return null; // layout already redirected

  const ip = (await headers()).get('x-forwarded-for');
  await recordOperatorAction({ operator, action: 'operator.list-companies', ip });

  const db = privilegedClient('operator');
  const { data: companies } = await db
    .from('accounts')
    .select('id, slug, name, status, created_at')
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Operator console</h1>
          <p className="text-muted-foreground text-sm">
            Signed in as {operator.name}. Every action here is recorded.
          </p>
        </div>
        <span className="text-muted-foreground text-xs">
          {companies?.length ?? 0} companies
        </span>
      </header>

      <ul className="divide-border divide-y rounded-md border">
        {(companies ?? []).map((c) => (
          <li key={c.id as string} className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex-1 text-sm font-medium">{c.name as string}</span>
            <code className="text-muted-foreground font-mono text-xs">
              /{(c.slug as string) ?? '—'}
            </code>
            <span
              className={
                c.status === 'active'
                  ? 'text-xs text-emerald-500'
                  : 'text-xs text-red-500'
              }
            >
              {c.status as string}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
