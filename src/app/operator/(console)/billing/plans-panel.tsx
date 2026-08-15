'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';

import type { Plan } from '@/lib/operator/billing';
import { formatMinor } from '@/lib/billing/money';
import { CURRENCIES } from '@/lib/currency';

/**
 * The plans you sell.
 *
 * Nothing is seeded: no starter tier, no suggested price. Inventing a
 * price and hoping it gets corrected is how a placeholder ends up on an
 * invoice.
 *
 * Retiring rather than deleting is the only option offered for a plan
 * with subscribers. Deleting it would break the link from a company to
 * what it agreed to pay, and the history has to keep meaning what it
 * meant.
 */
export function PlansPanel({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong');
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-medium">Plans</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="border-border hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New plan
        </button>
      </div>

      {open && (
        <div className="border-border bg-muted/30 border-b p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 basis-48 text-xs">
              <span className="mb-1 block font-medium">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard"
                className="border-border bg-background focus:ring-ring w-full rounded-md border px-2.5 py-1.5 text-sm focus:ring-2 focus:outline-none"
              />
            </label>

            <label className="basis-28 text-xs">
              <span className="mb-1 block font-medium">Amount</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="border-border bg-background focus:ring-ring w-full rounded-md border px-2.5 py-1.5 text-sm tabular-nums focus:ring-2 focus:outline-none"
              />
            </label>

            <label className="basis-28 text-xs">
              <span className="mb-1 block font-medium">Currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="border-border bg-background focus:ring-ring w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="basis-28 text-xs">
              <span className="mb-1 block font-medium">Billed</span>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value as 'month' | 'year')}
                className="border-border bg-background focus:ring-ring w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
              >
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </label>

            <label className="w-full text-xs">
              <span className="mb-1 block font-medium">
                Description
                <span className="text-muted-foreground font-normal">
                  {' '}
                  — shown on the pricing section and signup page
                </span>
              </span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this plan includes, in one line."
                className="border-border bg-background focus:ring-ring w-full rounded-md border px-2.5 py-1.5 text-sm focus:ring-2 focus:outline-none"
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await post({ name, amount, currency, interval, description });
                if (ok) {
                  setName('');
                  setAmount('');
                  setDescription('');
                  setOpen(false);
                }
              }}
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>
      )}

      {plans.length === 0 ? (
        <div className="text-muted-foreground px-4 py-8 text-center text-sm">
          No plans yet. Create one before putting a company on billing.
        </div>
      ) : (
        <ul className="divide-border divide-y">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {p.name}
                  {!p.isActive && (
                    <span className="text-muted-foreground ml-2 text-xs font-normal">retired</span>
                  )}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {p.description || `${p.subscribers} ${p.subscribers === 1 ? 'company' : 'companies'}`}
                </span>
              </span>

              <span className="text-sm font-medium tabular-nums">
                {formatMinor(p.amountMinor, p.currency)}
                <span className="text-muted-foreground font-normal">
                  /{p.interval === 'year' ? 'yr' : 'mo'}
                </span>
              </span>

              {p.isActive && (
                <button
                  type="button"
                  disabled={busy}
                  title={
                    p.highlight
                      ? 'Shown as Recommended on the pricing section'
                      : 'Mark as Recommended on the pricing section'
                  }
                  onClick={() => post({ action: 'update', id: p.id, highlight: !p.highlight })}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                    p.highlight
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {p.highlight ? 'Recommended' : 'Recommend'}
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => post({ action: p.isActive ? 'retire' : 'restore', id: p.id })}
                className="border-border hover:bg-muted rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
              >
                {p.isActive ? 'Retire' : 'Restore'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
