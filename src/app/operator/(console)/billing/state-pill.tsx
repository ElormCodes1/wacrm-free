import type { BillingState } from '@/lib/operator/billing';

/**
 * Billing state, in words a person would use.
 *
 * "no_period" and "unbilled" are different problems and are labelled
 * differently: one is a company nobody has priced, the other is one that
 * has a plan but no renewal date, which is usually a half-finished setup.
 */
const LABELS: Record<BillingState, { text: string; tone: string }> = {
  current: { text: 'current', tone: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25' },
  due_soon: { text: 'due soon', tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 ring-amber-500/25' },
  overdue: { text: 'overdue', tone: 'bg-red-500/12 text-red-700 dark:text-red-400 ring-red-500/25' },
  trialing: { text: 'trial', tone: 'bg-sky-500/12 text-sky-700 dark:text-sky-400 ring-sky-500/25' },
  unbilled: { text: 'no plan', tone: 'bg-muted text-muted-foreground ring-border' },
  no_period: { text: 'no renewal date', tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 ring-amber-500/25' },
  canceled: { text: 'canceled', tone: 'bg-muted text-muted-foreground ring-border' },
};

export function BillingStatePill({ state }: { state: BillingState }) {
  const { text, tone } = LABELS[state] ?? LABELS.unbilled;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {text}
    </span>
  );
}
