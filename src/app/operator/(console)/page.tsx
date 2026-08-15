import { headers } from 'next/headers';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Check } from 'lucide-react';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { listCompanies, platformOverview, listOperatorAudit } from '@/lib/operator/companies';
import {
  PageHeader,
  Metric,
  Card,
  EmptyState,
  Table,
  THead,
  TBody,
  TH,
  TD,
  formatDateTime,
} from './ui';

/**
 * Overview — the page you open first.
 *
 * It answers two questions and no others: how is the platform doing, and
 * is anything wrong right now. The company table lives on its own page
 * because a dashboard that is also a table is neither.
 *
 * Viewing this is recorded before the data is rendered — a read that
 * crosses company lines is exactly what the trail exists to capture, and
 * recording it afterwards would miss the ones that fail halfway.
 */
export default async function OperatorOverview() {
  const operator = await getOperator();
  if (!operator) return null; // layout already redirected

  const ip = (await headers()).get('x-forwarded-for');
  await recordOperatorAction({ operator, action: 'operator.overview', ip });

  const [overview, companies, audit] = await Promise.all([
    platformOverview(),
    listCompanies(),
    listOperatorAudit(6),
  ]);

  // Only things that can be acted on, each pointing at the company it
  // concerns. A dashboard that reports problems without saying where they
  // are makes you go looking, which is the part that wastes the time.
  const issues = [
    ...companies
      .filter((c) => c.numbersDown > 0)
      .map((c) => ({
        key: `down-${c.id}`,
        company: c.name,
        slug: c.slug,
        text:
          c.numbersDown === 1
            ? 'A WhatsApp number is not connected'
            : `${c.numbersDown} WhatsApp numbers are not connected`,
      })),
    ...companies
      .filter((c) => c.status === 'suspended')
      .map((c) => ({
        key: `susp-${c.id}`,
        company: c.name,
        slug: c.slug,
        text: c.suspendedReason ? `Suspended — ${c.suspendedReason}` : 'Suspended',
      })),
  ];

  const totalConversations = companies.reduce((sum, c) => sum + c.conversations, 0);

  const platformIssues = [
    overview.automationsFailed7d > 0 && {
      key: 'auto',
      text: `${overview.automationsFailed7d} automation ${overview.automationsFailed7d === 1 ? 'failure' : 'failures'} in the last 7 days`,
    },
    overview.mediaFailed7d > 0 && {
      key: 'media',
      text: `${overview.mediaFailed7d} media ${overview.mediaFailed7d === 1 ? 'download' : 'downloads'} failed in the last 7 days`,
    },
  ].filter(Boolean) as { key: string; text: string }[];

  return (
    <>
      <PageHeader
        title="Overview"
        description="How the platform is doing, and anything that needs attention today."
      />

      <div className="space-y-6 p-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Metric
            label="Companies"
            value={overview.companiesTotal}
            sub={`${overview.companiesActive} active · ${overview.companiesSuspended} suspended`}
          />
          <Metric
            label="New this month"
            value={overview.signups30d}
            sub={`${overview.signups7d} in the last 7 days`}
          />
          <Metric
            label="Numbers connected"
            value={`${overview.numbersConnected}/${overview.numbersTotal}`}
            sub={overview.numbersDown > 0 ? `${overview.numbersDown} down` : 'all healthy'}
            tone={overview.numbersDown > 0 ? 'warn' : 'default'}
          />
          <Metric
            label="Messages today"
            value={overview.messages24h}
            sub={`${overview.messages7d} in the last 7 days`}
          />
        </div>

        {/* Attention and platform totals sit side by side because both are
            short; activity runs full width below because it is a list that
            grows. Stacking a short card above a tall one leaves a column of
            nothing, which is what made this look unfinished. */}
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="Needs attention">
              {issues.length === 0 && platformIssues.length === 0 ? (
                <div className="text-muted-foreground flex items-center gap-2.5 px-4 py-6 text-sm">
                  <Check className="h-4 w-4 text-emerald-500" />
                  Nothing to deal with. Every number is connected and no company is suspended.
                </div>
              ) : (
                <ul className="divide-border divide-y">
                  {issues.map((i) => (
                    <li key={i.key}>
                      <Link
                        href={`/operator/c/${i.slug}`}
                        className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors"
                      >
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{i.company}</span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {i.text}
                          </span>
                        </span>
                        <ArrowRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                      </Link>
                    </li>
                  ))}
                  {platformIssues.map((i) => (
                    <li key={i.key} className="flex items-center gap-3 px-4 py-3">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="text-sm">{i.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Platform">
            <dl className="divide-border divide-y text-sm">
              <Row label="Contacts" value={overview.contactsTotal.toLocaleString()} />
              <Row label="Conversations" value={totalConversations.toLocaleString()} />
              <Row label="Numbers" value={overview.numbersTotal} />
              <Row label="Dormant 30d" value={overview.companiesDormant} />
            </dl>
          </Card>
        </div>

        <Card
          title="Recent activity"
          action={
            <Link
              href="/operator/audit"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              View all
            </Link>
          }
        >
          {audit.length === 0 ? (
            <EmptyState title="Nothing recorded yet" />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Operator</TH>
                <TH>Action</TH>
                <TH>Company</TH>
              </THead>
              <TBody>
                {audit.map((e) => (
                  <tr key={e.id}>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(e.occurredAt)}
                    </TD>
                    <TD className="whitespace-nowrap">{e.operatorName ?? 'unknown'}</TD>
                    <TD>
                      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                        {e.action}
                      </code>
                    </TD>
                    <TD className="text-muted-foreground max-w-48 truncate">
                      {e.targetCompany ?? '—'}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}
