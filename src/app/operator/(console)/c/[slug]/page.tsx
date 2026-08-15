import { headers } from 'next/headers';
import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import {
  getCompanyDetail,
  getCompanyHealth,
  getCompanyUsage,
  type CompanyHealth,
} from '@/lib/operator/companies';
import { getCompanyBilling, listPlans } from '@/lib/operator/billing';
import { privilegedClient } from '@/lib/supabase/privileged';
import { planBreaches } from '@/lib/billing/limits';
import { StatusControl } from './status-control';
import { BillingPanel } from './billing-panel';
import { NumberHealth } from './number-health';
import {
  PageHeader,
  Metric,
  Card,
  StatusPill,
  Table,
  THead,
  TBody,
  TH,
  TD,
  EmptyState,
  formatDate,
} from '../../ui';

/**
 * One customer's company.
 *
 * Opening a specific company is recorded separately from listing them,
 * because "who looked at this customer, and when" is the question
 * actually asked after a complaint, and a list-view entry cannot answer
 * it.
 */
export default async function OperatorCompany({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const operator = await getOperator();
  if (!operator) return null;

  const { slug } = await params;
  const company = await getCompanyDetail(slug);
  // Health is the question support starts from, so it is fetched with the
  // company rather than behind another click.
  const health = company ? await getCompanyHealth(company.id) : null;
  const usage = company
    ? await getCompanyUsage(company.id)
    : { storageBytes: 0, broadcastSends30d: 0 };
  const [billing, plans, defaultCurrency] = company
    ? await Promise.all([
        getCompanyBilling(company.id),
        listPlans(true),
        privilegedClient('operator')
          .from('accounts')
          .select('default_currency')
          .eq('id', company.id)
          .maybeSingle()
          .then((r) => (r.data?.default_currency as string) ?? 'USD'),
      ])
    : [null, [], 'USD'];

  const ip = (await headers()).get('x-forwarded-for');
  await recordOperatorAction({
    operator,
    action: 'company.view',
    targetAccountId: company?.id ?? null,
    detail: { slug, found: Boolean(company) },
    ip,
  });

  if (!company) {
    return (
      <>
        <PageHeader title="Unknown company" />
        <div className="p-8">
          <div className="border-border bg-card rounded-lg border">
            <EmptyState
              title="No company at that address"
              body={`Nothing is registered at /${slug}.`}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="border-border border-b px-8 pt-5 pb-6">
        <nav className="text-muted-foreground mb-3 flex items-center gap-1 text-xs">
          <Link href="/operator/companies" className="hover:text-foreground transition-colors">
            Companies
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground">{company.name}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{company.name}</h1>
              <StatusPill status={company.status} />
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">/{company.slug}</p>
          </div>
          <p className="text-muted-foreground text-sm">
            Signed up {formatDate(company.createdAt)} · last message{' '}
            {formatDate(company.lastActivityAt, 'never')}
          </p>
        </div>
      </div>

      <div className="space-y-6 p-8">
        {company.status === 'suspended' && (
          <div className="flex gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Suspended{company.suspendedAt ? ` on ${formatDate(company.suspendedAt)}` : ''}
              </p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {company.suspendedReason || 'No reason recorded.'}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Metric label="Members" value={company.members} />
          <Metric
            label="Numbers"
            value={`${company.numbers - company.numbersDown}/${company.numbers}`}
            sub={company.numbersDown > 0 ? `${company.numbersDown} down` : 'connected'}
            tone={company.numbersDown > 0 ? 'warn' : 'default'}
          />
          <Metric label="Contacts" value={company.contacts.toLocaleString()} />
          <Metric
            label="Messages today"
            value={health?.messages24h ?? 0}
            sub="last 24 hours"
          />
          <Metric
            label="Media stored"
            value={`${Math.round(usage.storageBytes / (1024 * 1024))} MB`}
            sub={
              billing?.maxStorageMb != null
                ? `of ${billing.maxStorageMb} MB included`
                : 'no limit on this plan'
            }
            tone={
              billing?.maxStorageMb != null &&
              usage.storageBytes > billing.maxStorageMb * 1024 * 1024
                ? 'warn'
                : 'default'
            }
          />
        </div>

        {health && (
          <Problems
            health={health}
            overPlan={planBreaches({
              numbers: company.numbers,
              members: company.members,
              storageBytes: usage.storageBytes,
              broadcastSends30d: usage.broadcastSends30d,
              maxNumbers: billing?.maxNumbers ?? null,
              maxMembers: billing?.maxMembers ?? null,
              maxStorageMb: billing?.maxStorageMb ?? null,
              maxBroadcastSends30d: billing?.maxBroadcastSends30d ?? null,
              planName: billing?.planName ?? null,
            })}
          />
        )}

        {billing && (
          <BillingPanel
            slug={company.slug ?? ''}
            billing={billing}
            plans={plans}
            defaultCurrency={defaultCurrency}
          />
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Members">
            {company.membersList.length === 0 ? (
              <EmptyState title="No members" />
            ) : (
              <Table>
                <THead>
                  <TH>Name</TH>
                  <TH>Role</TH>
                  <TH align="right">Joined</TH>
                </THead>
                <TBody>
                  {company.membersList.map((m) => (
                    <tr key={m.email ?? m.createdAt}>
                      <TD>
                        <span className="block truncate font-medium">
                          {m.fullName || m.email}
                        </span>
                        {m.fullName && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {m.email}
                          </span>
                        )}
                      </TD>
                      <TD>
                        {m.isActive ? (
                          <span className="text-muted-foreground text-sm">{m.role}</span>
                        ) : (
                          <span className="text-xs text-red-600 dark:text-red-400">
                            deactivated
                          </span>
                        )}
                      </TD>
                      <TD align="right" className="text-muted-foreground text-sm">
                        {formatDate(m.createdAt)}
                      </TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card title="WhatsApp numbers">
            {!health || health.numbers.length === 0 ? (
              <EmptyState
                title="No numbers connected"
                body="This company has not paired a WhatsApp number yet."
              />
            ) : (
              <ul className="divide-border divide-y">
                {health.numbers.map((n) => (
                  <NumberHealth key={n.id} slug={company.slug ?? ''} number={n} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <StatusControl
          slug={company.slug ?? ''}
          name={company.name}
          status={company.status}
          members={company.members}
        />
      </div>
    </>
  );
}

/**
 * What is currently wrong, if anything.
 *
 * Silent when everything is fine. A panel that always renders "0 failures"
 * teaches you to skip it, and then it is not there on the day it matters.
 */
function Problems({
  health,
  overPlan,
}: {
  health: CompanyHealth;
  overPlan: { text: string }[];
}) {
  const problems = [
    ...overPlan.map((b) => ({
      title: `Using more than the plan includes`,
      body: `${b.text}. Nothing is blocked — this is here so you can decide whether to move them up a tier.`,
    })),
    health.numbers.some((n) => n.connectionState !== 'open') && {
      title: 'A number is not connected',
      body: 'Inbound messages stop while a socket is down. Use Check / restart below — it probes for real rather than trusting the stored state.',
    },
    health.automationsFailed7d > 0 && {
      title: `${health.automationsFailed7d} automation ${health.automationsFailed7d === 1 ? 'failure' : 'failures'} in 7 days`,
      body: health.automationLastError ?? 'No error message recorded.',
    },
    health.mediaFailed7d > 0 && {
      title: `${health.mediaFailed7d} media ${health.mediaFailed7d === 1 ? 'download' : 'downloads'} failed in 7 days`,
      body: 'Voice notes, images or documents that arrived but could not be stored. The customer sees a broken attachment.',
    },
    health.broadcastsWithFailures7d > 0 && {
      title: `${health.broadcastsWithFailures7d} ${health.broadcastsWithFailures7d === 1 ? 'broadcast' : 'broadcasts'} had failed recipients`,
      body: 'Some recipients did not receive the message.',
    },
    health.messages24h === 0 &&
      health.inboundStale && {
        title: 'Nothing received recently',
        body: 'No inbound message for over three days. Could be a quiet customer, or a number that looks connected and is not — worth a check below.',
      },
  ].filter(Boolean) as { title: string; body: string }[];

  if (problems.length === 0) return null;

  return (
    <div className="space-y-2">
      {problems.map((p) => (
        <div
          key={p.title}
          className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{p.title}</p>
            <p className="text-muted-foreground mt-0.5 text-sm">{p.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
