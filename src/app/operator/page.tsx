import { headers } from 'next/headers';
import Link from 'next/link';
import { Search } from 'lucide-react';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { listCompanies } from '@/lib/operator/companies';

/**
 * The company list.
 *
 * Viewing this is itself an operator action and is recorded before the
 * data is rendered — a read that crosses company lines is exactly what
 * the trail exists to capture, and recording it afterwards would miss the
 * ones that fail halfway.
 */
export default async function OperatorHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const operator = await getOperator();
  if (!operator) return null; // layout already redirected

  const { q } = await searchParams;
  const ip = (await headers()).get('x-forwarded-for');

  await recordOperatorAction({
    operator,
    action: 'operator.list-companies',
    detail: q ? { query: q } : undefined,
    ip,
  });

  const companies = await listCompanies(q);
  const suspended = companies.filter((c) => c.status === 'suspended').length;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Companies</h1>
          <p className="text-muted-foreground text-sm">
            {companies.length} {companies.length === 1 ? 'company' : 'companies'}
            {suspended > 0 && ` · ${suspended} suspended`}
          </p>
        </div>

        {/* A plain GET form: no JavaScript, and the search survives a
            reload or a shared link. */}
        <form className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search name or address"
            className="border-border bg-background focus:ring-ring w-64 rounded-md border py-1.5 pr-3 pl-8 text-sm focus:ring-2 focus:outline-none"
          />
        </form>
      </header>

      {companies.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-8 text-center text-sm">
          {q ? `Nothing matches “${q}”.` : 'No companies yet.'}
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {companies.map((c) => (
            <li key={c.id}>
              <Link
                href={`/operator/c/${c.slug}`}
                className="hover:bg-muted/50 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="text-muted-foreground font-mono text-xs">/{c.slug ?? '—'}</span>
                </span>

                <span className="text-muted-foreground text-xs whitespace-nowrap">
                  {c.members} {c.members === 1 ? 'member' : 'members'} · {c.numbers}{' '}
                  {c.numbers === 1 ? 'number' : 'numbers'} · {c.contacts} contacts
                </span>

                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                    c.status === 'active'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-500/15 text-red-600 dark:text-red-400'
                  }`}
                >
                  {c.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
