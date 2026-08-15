import Link from 'next/link';

import { getOperator } from '@/lib/operator/session';
import { listOperatorAudit } from '@/lib/operator/companies';

/**
 * The operator trail.
 *
 * Deliberately NOT recorded as an operator action itself. Every other
 * page here logs the fact it was opened, but logging reads of the log
 * produces an entry for looking at the entry for looking at the log, and
 * the useful signal drowns. Nothing customer-facing is exposed by it
 * either — this page shows what operators did, not what customers have.
 */
export default async function OperatorAudit() {
  const operator = await getOperator();
  if (!operator) return null;

  const entries = await listOperatorAudit();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold">Audit trail</h1>
        <p className="text-muted-foreground text-sm">
          The last {entries.length} operator {entries.length === 1 ? 'action' : 'actions'}, newest
          first. Written by the console itself and not editable through it.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-8 text-center text-sm">
          Nothing recorded yet.
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
              <span className="text-muted-foreground w-36 shrink-0 font-mono text-xs">
                {new Date(e.occurredAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>

              <span className="font-medium">{e.operatorName ?? 'unknown'}</span>

              <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{e.action}</span>

              {e.targetCompany && (
                <span className="text-muted-foreground min-w-0 truncate text-xs">
                  {e.targetAccountId ? (
                    <Link href={`/operator`} className="hover:text-foreground">
                      {e.targetCompany}
                    </Link>
                  ) : (
                    e.targetCompany
                  )}
                </span>
              )}

              {typeof e.detail?.reason === 'string' && e.detail.reason && (
                <span className="text-muted-foreground truncate text-xs italic">
                  “{e.detail.reason}”
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
