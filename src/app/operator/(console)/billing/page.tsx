import { headers } from 'next/headers';
import Link from 'next/link';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { listCompanies, withUsage } from '@/lib/operator/companies';
import { billingOverview, listPlans, listUpgradeRequests } from '@/lib/operator/billing';
import { formatMinor } from '@/lib/billing/money';
import { planBreaches } from '@/lib/billing/limits';
import { PlansPanel } from './plans-panel';
import { UpgradeRequests } from './upgrade-requests';
import {
  PageHeader,
  Metric,
  Card,
  Table,
  THead,
  TBody,
  TH,
  TD,
  EmptyState,
  formatDate,
} from '../ui';
import { BillingStatePill } from './state-pill';

/**
 * Billing.
 *
 * Revenue is shown per currency and never summed. There is no exchange
 * rate in this system, so a single combined figure would have to invent
 * one — producing a number that looks authoritative and is not. Two true
 * rows beat one false headline.
 */
export default async function OperatorBilling() {
  const operator = await getOperator();
  if (!operator) return null;

  const ip = (await headers()).get('x-forwarded-for');
  await recordOperatorAction({ operator, action: 'billing.view', ip });

  const [overview, rawCompanies, plans, upgrades] = await Promise.all([
    billingOverview(),
    listCompanies(),
    listPlans(true),
    listUpgradeRequests(),
  ]);
  const companies = await withUsage(rawCompanies);

  // Overdue first, then due soon, then everyone else — the list is a work
  // queue, not an alphabetical directory.
  const rank: Record<string, number> = {
    overdue: 0,
    due_soon: 1,
    no_period: 2,
    unbilled: 3,
    trialing: 4,
    current: 5,
    canceled: 6,
  };
  const sorted = [...companies].sort(
    (a, b) => (rank[a.billingState] ?? 9) - (rank[b.billingState] ?? 9)
  );

  return (
    <>
      <PageHeader
        title="Billing"
        description="What each company is on, and whether they have paid."
      />

      <div className="space-y-6 p-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MoneyMetric label="Monthly recurring" rows={overview.mrr} empty="nothing billed yet" />
          <MoneyMetric
            label="Collected (30d)"
            rows={overview.collected30d}
            empty="no payments yet"
          />
          <Metric
            label="Overdue"
            value={overview.overdue}
            sub={overview.dueSoon > 0 ? `${overview.dueSoon} due within 7 days` : 'none due soon'}
            tone={overview.overdue > 0 ? 'warn' : 'default'}
          />
          <Metric
            label="Not on a plan"
            value={overview.unbilled}
            sub={`${overview.trialing} trialing · ${overview.canceled} canceled`}
            tone={overview.unbilled > 0 ? 'warn' : 'default'}
          />
        </div>

        {/* Above the plans: someone waiting to pay more outranks
            everything else on this page. */}
        <UpgradeRequests requests={upgrades} />

        <PlansPanel plans={plans} />

        <Card title="Companies">
          {sorted.length === 0 ? (
            <EmptyState title="No companies yet" />
          ) : (
            <Table>
              <THead>
                <TH>Company</TH>
                <TH>Plan</TH>
                <TH align="right">Amount</TH>
                <TH align="right">Numbers</TH>
                <TH align="right">Storage</TH>
                <TH>Renews</TH>
                <TH>Billing</TH>
                <TH>Account</TH>
              </THead>
              <TBody>
                {sorted.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                    <TD>
                      <Link
                        href={`/operator/c/${c.slug}`}
                        className="hover:text-primary font-medium transition-colors"
                      >
                        {c.name}
                      </Link>
                      <span className="text-muted-foreground block truncate font-mono text-xs">
                        /{c.slug}
                      </span>
                    </TD>
                    <TD className="text-muted-foreground">{c.planName ?? '—'}</TD>
                    <TD align="right">
                      {c.amountMinor !== null && c.currency
                        ? formatMinor(c.amountMinor, c.currency)
                        : '—'}
                    </TD>
                    <TD align="right">
                      {(() => {
                        const over = planBreaches({
                          numbers: c.numbers,
                          members: c.members,
                          maxNumbers: c.maxNumbers,
                          maxMembers: c.maxMembers,
                          planName: c.planName,
                        }).some((b) => b.kind === 'numbers');
                        const ceiling = c.maxNumbers === null ? '∞' : c.maxNumbers;
                        return (
                          <span
                            className={
                              over
                                ? 'font-medium text-amber-600 dark:text-amber-400'
                                : 'text-muted-foreground'
                            }
                            title={over ? 'Using more than this plan includes' : undefined}
                          >
                            {c.numbers}
                            {c.planName ? ` / ${ceiling}` : ''}
                          </span>
                        );
                      })()}
                    </TD>
                    <TD align="right">
                      {(() => {
                        const mb = Math.round(c.storageBytes / (1024 * 1024));
                        const over = c.maxStorageMb !== null && mb > c.maxStorageMb;
                        return (
                          <span
                            className={
                              over
                                ? 'font-medium text-amber-600 dark:text-amber-400'
                                : 'text-muted-foreground'
                            }
                            title={over ? 'Over the storage this plan includes' : undefined}
                          >
                            {mb} MB
                            {c.planName && c.maxStorageMb !== null ? ` / ${c.maxStorageMb}` : ''}
                          </span>
                        );
                      })()}
                    </TD>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDate(c.periodEnd, '—')}
                    </TD>
                    <TD>
                      <BillingStatePill state={c.billingState} />
                    </TD>
                    <TD>
                      <span
                        className={
                          c.status === 'suspended'
                            ? 'text-xs text-red-600 dark:text-red-400'
                            : 'text-muted-foreground text-xs'
                        }
                      >
                        {c.status}
                      </span>
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

/**
 * A money figure that may exist in more than one currency.
 *
 * Renders every currency rather than picking one, because picking one
 * would hide revenue.
 */
function MoneyMetric({
  label,
  rows,
  empty,
}: {
  label: string;
  rows: { currency: string; amountMinor: number; companies?: number }[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <Metric label={label} value="—" sub={empty} />;
  }
  const [first, ...rest] = rows;
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">
        {formatMinor(first.amountMinor, first.currency)}
      </p>
      {rest.length > 0 ? (
        <p className="text-muted-foreground mt-0.5 text-xs">
          {rest.map((r) => formatMinor(r.amountMinor, r.currency)).join(' · ')}
        </p>
      ) : (
        first.companies !== undefined && (
          <p className="text-muted-foreground mt-0.5 text-xs">
            {first.companies} {first.companies === 1 ? 'company' : 'companies'}
          </p>
        )
      )}
    </div>
  );
}
