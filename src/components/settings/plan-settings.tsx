'use client';

import { CreditCard } from 'lucide-react';

import { usePlanUsage, type PlanUsage } from '@/lib/billing/use-plan-usage';
import { formatMinor } from '@/lib/billing/money';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';

/**
 * What this company is on, and what it is using.
 *
 * Exists because the upgrade prompts were arriving from nowhere: a
 * customer met a limit they had never been shown, on a plan they could
 * not see, for a price they had not been told. A nag with no page behind
 * it reads as a shakedown rather than an offer.
 *
 * Every figure here is one the operator console shows too, from the same
 * function — so a support conversation is two people looking at the same
 * numbers rather than one of them being told what the other can see.
 */
export function PlanSettings() {
  const { usage, loading } = usePlanUsage();

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Plan & usage"
        description="What this workspace is on, and how much of it you are using."
      />

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : !usage ? (
        <NoPlan />
      ) : (
        <Plan usage={usage} />
      )}
    </section>
  );
}

/**
 * A company nobody has priced yet.
 *
 * Says so plainly instead of showing an empty plan card. "No plan" is a
 * real and currently common state — it is what every company signed up
 * before plans existed is in — and dressing it up as a problem would
 * alarm people who owe nothing.
 */
function NoPlan() {
  return (
    <div className="border-border bg-card rounded-lg border p-6">
      <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
        <CreditCard className="text-muted-foreground h-5 w-5" />
      </div>
      <p className="mt-3 font-medium">This workspace is not on a plan</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Everything works as normal. If you would like to be put on one, ask and we will
        set it up.
      </p>
    </div>
  );
}

function Plan({ usage }: { usage: PlanUsage }) {
  const price =
    usage.amountMinor !== null && usage.currency
      ? `${formatMinor(usage.amountMinor, usage.currency)}/${usage.interval === 'year' ? 'year' : 'month'}`
      : '—';

  return (
    <div className="space-y-4">
      <div className="border-border bg-card rounded-lg border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">{usage.planName}</p>
            <p className="text-muted-foreground text-sm">{price}</p>
          </div>
          {usage.allowApi && (
            <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs">
              REST API included
            </span>
          )}
        </div>
      </div>

      <div className="border-border bg-card space-y-4 rounded-lg border p-5">
        <p className="text-sm font-medium">Usage</p>
        <Meter label="WhatsApp numbers" used={usage.numbers} limit={usage.maxNumbers} />
        <Meter label="Team members" used={usage.members} limit={usage.maxMembers} />
        <Meter
          label="Media stored"
          used={Math.round(usage.storageBytes / (1024 * 1024))}
          limit={usage.maxStorageMb}
          unit="MB"
        />
        <Meter
          label="Broadcast messages (30 days)"
          used={usage.broadcastSends30d}
          limit={usage.maxBroadcastSends30d}
        />
      </div>

      {/* One prompt covering whatever they have actually exceeded, rather
          than one per breach — four boxes saying the same thing is a wall,
          not a message. */}
      {usage.breaches.length > 0 && (
        <UpgradePrompt
          // The first breach names what to talk about. 'api' is never in
          // this list — it is a plan flag rather than a ceiling that gets
          // exceeded, and it has its own prompt on the API keys page.
          reason={usage.breaches[0].kind}
          title={
            usage.breaches.length === 1
              ? 'You are over what this plan includes'
              : `You are over ${usage.breaches.length} of this plan's limits`
          }
          body={`${usage.breaches.map((b) => b.text).join('; ')}. Nothing has been blocked — ask us about a plan that fits.`}
        />
      )}
    </div>
  );
}

/**
 * One line of usage.
 *
 * An unlimited allowance gets no bar at all. A bar implies a ceiling, and
 * drawing one at some arbitrary width for "unlimited" invites the
 * question of what happens at the end of it.
 */
function Meter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}) {
  const suffix = unit ? ` ${unit}` : '';

  if (limit === null) {
    return (
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {used.toLocaleString()}
          {suffix} <span className="text-xs">· unlimited</span>
        </span>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((used / limit) * 100));
  const over = used > limit;
  const near = !over && pct >= 80;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span
          className={`tabular-nums ${
            over ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
          }`}
        >
          {used.toLocaleString()}
          {suffix} of {limit.toLocaleString()}
          {suffix}
        </span>
      </div>
      <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
        <div
          style={{ width: `${Math.max(pct, used > 0 ? 3 : 0)}%` }}
          className={`h-1.5 rounded-full ${
            over ? 'bg-amber-500' : near ? 'bg-amber-400' : 'bg-primary'
          }`}
        />
      </div>
    </div>
  );
}
