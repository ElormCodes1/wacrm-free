import Link from 'next/link';

import { getOperator } from '@/lib/operator/session';
import { listOperatorAudit } from '@/lib/operator/companies';
import { PageHeader, Table, THead, TBody, TH, TD, EmptyState, formatDateTime } from '../ui';

/**
 * The operator trail.
 *
 * Deliberately NOT recorded as an operator action itself. Every other
 * page here logs the fact it was opened, but logging reads of the log
 * produces an entry for looking at the entry for looking at the log, and
 * the useful signal drowns. Nothing customer-facing is exposed by it
 * either — it shows what operators did, not what customers have.
 */
export default async function OperatorAudit() {
  const operator = await getOperator();
  if (!operator) return null;

  const entries = await listOperatorAudit();

  return (
    <>
      <PageHeader
        title="Audit trail"
        description={`The last ${entries.length} operator ${entries.length === 1 ? 'action' : 'actions'}, newest first. Written by the console and not editable through it.`}
      />

      <div className="p-8">
        <div className="border-border bg-card overflow-hidden rounded-lg border">
          {entries.length === 0 ? (
            <EmptyState
              title="Nothing recorded yet"
              body="Operator actions appear here as they happen."
            />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Operator</TH>
                <TH>Action</TH>
                <TH>Company</TH>
                <TH>Detail</TH>
              </THead>
              <TBody>
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/40 transition-colors">
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(e.occurredAt)}
                    </TD>
                    <TD className="whitespace-nowrap">{e.operatorName ?? 'unknown'}</TD>
                    <TD>
                      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                        {e.action}
                      </code>
                    </TD>
                    <TD className="max-w-48 truncate">
                      {e.targetCompany ? (
                        e.targetAccountId ? (
                          <Link
                            href="/operator/companies"
                            className="hover:text-primary transition-colors"
                          >
                            {e.targetCompany}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground italic">{e.targetCompany}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="text-muted-foreground max-w-64 truncate text-xs">
                      {describe(e.detail)}
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

/**
 * The parts of an entry's detail worth a column, in plain words.
 * Dumping the raw JSON would be honest and unreadable.
 */
function describe(detail: Record<string, unknown> | null): string {
  if (!detail) return '';
  const bits: string[] = [];
  if (typeof detail.reason === 'string' && detail.reason) bits.push(`“${detail.reason}”`);
  if (typeof detail.query === 'string' && detail.query) bits.push(`search: ${detail.query}`);
  if (typeof detail.label === 'string' && detail.label) bits.push(detail.label);
  if (detail.restarted === true) bits.push('restarted');
  else if (detail.aliveBefore === true) bits.push('socket healthy, left alone');
  else if (detail.aliveBefore === false) bits.push('socket was dead');
  if (detail.found === false) bits.push('not found');
  return bits.join(' · ');
}
