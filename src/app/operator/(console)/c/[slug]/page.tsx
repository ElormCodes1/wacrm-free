import { headers } from 'next/headers';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { getOperator, recordOperatorAction } from '@/lib/operator/session';
import { getCompanyDetail, getCompanyHealth, type CompanyHealth } from '@/lib/operator/companies';
import { StatusControl } from './status-control';
import { NumberHealth } from './number-health';

/**
 * One customer's company, in full.
 *
 * Opening a specific company is recorded separately from listing them:
 * "who looked at this customer, and when" is the question actually asked
 * after a complaint, and a generic list-view entry cannot answer it.
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
      <main className="mx-auto max-w-3xl p-6">
        <BackLink />
        <p className="text-muted-foreground border-border mt-4 rounded-md border border-dashed p-8 text-center text-sm">
          No company at <code className="font-mono">/{slug}</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{company.name}</h1>
          <p className="text-muted-foreground font-mono text-sm">/{company.slug}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            company.status === 'active'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-500/15 text-red-600 dark:text-red-400'
          }`}
        >
          {company.status}
        </span>
      </header>

      {company.status === 'suspended' && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">
            Suspended {company.suspendedAt ? `on ${formatDate(company.suspendedAt)}` : ''}
          </p>
          <p className="text-muted-foreground mt-1">
            {company.suspendedReason || 'No reason recorded.'}
          </p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Members" value={company.members} />
        <Stat label="Numbers" value={company.numbers} />
        <Stat label="Contacts" value={company.contacts} />
        <Stat label="Conversations" value={company.conversations} />
      </section>

      <section className="text-muted-foreground text-sm">
        Signed up {formatDate(company.createdAt)} · last message{' '}
        {company.lastActivityAt ? formatDate(company.lastActivityAt) : 'never'}
      </section>

      <Panel title="Members">
        {company.membersList.length === 0 ? (
          <Empty>No members.</Empty>
        ) : (
          <ul className="divide-border divide-y">
            {company.membersList.map((m) => (
              <li key={m.email ?? m.createdAt} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.fullName || m.email}</span>
                  {m.fullName && (
                    <span className="text-muted-foreground block truncate text-xs">{m.email}</span>
                  )}
                </span>
                <span className="text-muted-foreground text-xs">{m.role}</span>
                {!m.isActive && (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-600 dark:text-red-400">
                    deactivated
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="WhatsApp numbers">
        {!health || health.numbers.length === 0 ? (
          <Empty>No numbers connected.</Empty>
        ) : (
          <ul className="divide-border divide-y">
            {health.numbers.map((n) => (
              <NumberHealth key={n.id} slug={company.slug ?? ''} number={n} />
            ))}
          </ul>
        )}
      </Panel>

      {health && <Problems health={health} />}

      <StatusControl
        slug={company.slug ?? ''}
        name={company.name}
        status={company.status}
        members={company.members}
      />
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/operator"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      All companies
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border rounded-md border p-3">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
        {title}
      </h2>
      <div className="border-border overflow-hidden rounded-md border">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-3 py-4 text-sm">{children}</p>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * What is currently wrong, if anything.
 *
 * Silent when everything is fine. A panel that always renders "0 failures"
 * teaches you to skip it, and then it is not there on the day it matters.
 */
function Problems({ health }: { health: CompanyHealth }) {
  const problems = [
    health.numbers.some((n) => n.connectionState !== 'open') && {
      title: 'A number is not connected',
      body: 'Inbound messages stop while a socket is down. Use Check / restart above — it probes for real rather than trusting the stored state.',
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
  ].filter(Boolean) as { title: string; body: string }[];

  const quiet = health.messages24h === 0 && health.inboundStale;

  if (problems.length === 0 && !quiet) return null;

  return (
    <section>
      <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
        Needs attention
      </h2>
      <div className="space-y-2">
        {problems.map((p) => (
          <div
            key={p.title}
            className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
          >
            <p className="font-medium text-amber-600 dark:text-amber-400">{p.title}</p>
            <p className="text-muted-foreground mt-1 text-xs">{p.body}</p>
          </div>
        ))}
        {quiet && (
          <div className="border-border rounded-md border p-3 text-sm">
            <p className="font-medium">Nothing received recently</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Last inbound message {formatDate(health.lastInboundAt!)}. Could be a quiet customer,
              or a number that looks connected and is not — worth a check above.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
