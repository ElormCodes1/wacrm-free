import { headers } from 'next/headers';
import Link from 'next/link';
import { Search } from 'lucide-react';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { listCompanies } from '@/lib/operator/companies';
import {
  PageHeader,
  StatusPill,
  Table,
  THead,
  TBody,
  TH,
  TD,
  EmptyState,
  formatDate,
} from '../ui';

/**
 * Every company, as a table.
 *
 * A table rather than a list of link rows, because the questions asked
 * here are comparative — who has the most contacts, who has a number
 * down, who has not been active — and comparison needs columns you can
 * read down. The counts are right-aligned and tabular for the same
 * reason.
 */
export default async function OperatorCompanies({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const operator = await getOperator();
  if (!operator) return null;

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
    <>
      <PageHeader
        title="Companies"
        description={
          `${companies.length} ${companies.length === 1 ? 'company' : 'companies'}` +
          (suspended > 0 ? ` · ${suspended} suspended` : '')
        }
        actions={
          // A plain GET form: no JavaScript, and a search that survives a
          // reload or a pasted link.
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
        }
      />

      <div className="p-8">
        <div className="border-border bg-card overflow-hidden rounded-lg border">
          {companies.length === 0 ? (
            <EmptyState
              title={q ? `Nothing matches “${q}”` : 'No companies yet'}
              body={q ? 'Try part of the name, or the address.' : undefined}
            />
          ) : (
            <Table>
              <THead>
                <TH>Company</TH>
                <TH align="right">Members</TH>
                <TH align="right">Numbers</TH>
                <TH align="right">Contacts</TH>
                <TH>Last activity</TH>
                <TH>Signed up</TH>
                <TH>Status</TH>
              </THead>
              <TBody>
                {companies.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                    <TD>
                      <Link href={`/operator/c/${c.slug}`} className="group block min-w-0">
                        <span className="group-hover:text-primary block truncate font-medium transition-colors">
                          {c.name}
                        </span>
                        <span className="text-muted-foreground block truncate font-mono text-xs">
                          /{c.slug ?? '—'}
                        </span>
                      </Link>
                    </TD>
                    <TD align="right" className="text-muted-foreground">
                      {c.members}
                    </TD>
                    <TD align="right">
                      {c.numbersDown > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {c.numbers - c.numbersDown}/{c.numbers}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{c.numbers}</span>
                      )}
                    </TD>
                    <TD align="right" className="text-muted-foreground">
                      {c.contacts.toLocaleString()}
                    </TD>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDate(c.lastActivityAt, 'never')}
                    </TD>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDate(c.createdAt)}
                    </TD>
                    <TD>
                      <StatusPill status={c.status} />
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
