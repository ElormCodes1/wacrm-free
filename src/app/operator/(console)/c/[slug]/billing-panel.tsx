'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CompanyBilling, Plan, UpgradeRequest } from '@/lib/operator/billing';
import { CompanyUpgradeRequest } from '../../billing/upgrade-requests';
import { formatMinor } from '@/lib/billing/money';
import { BillingStatePill } from '../../billing/state-pill';

/**
 * One company's billing, and the two things you actually do with it.
 *
 * "Record a payment" is first and open by default when they owe money,
 * because it is the action taken ten times for every once the plan
 * changes. Changing the plan is behind a disclosure — it is rarer and
 * more consequential.
 *
 * The payment form defaults to the amount they are on, since the common
 * case is someone paying exactly what they were invoiced, but it stays
 * editable: part payments and corrections are normal and a form that
 * cannot express them gets worked around in the database.
 */
export function BillingPanel({
  slug,
  billing,
  plans,
  defaultCurrency,
  upgradeRequest,
}: {
  slug: string;
  billing: CompanyBilling;
  plans: Plan[];
  defaultCurrency: string;
  upgradeRequest?: UpgradeRequest | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const currency = billing.currency ?? defaultCurrency;
  const owed = billing.state === 'overdue' || billing.state === 'due_soon';

  // ---- record a payment ----
  const [amount, setAmount] = useState(
    billing.amountMinor !== null
      ? String(billing.amountMinor / 100).replace(/\.00$/, '')
      : ''
  );
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [extend, setExtend] = useState(true);

  // ---- change the plan ----
  const [planId, setPlanId] = useState(billing.planId ?? '');
  const [status, setStatus] = useState(billing.status ?? 'trialing');
  const [override, setOverride] = useState(
    billing.amountMinor !== null ? String(billing.amountMinor / 100) : ''
  );
  const [periodEnd, setPeriodEnd] = useState(billing.periodEnd?.slice(0, 10) ?? '');

  async function send(url: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong');
        return;
      }
      setNotice(json.paidUntil ? `${success} Paid up to ${json.paidUntil.slice(0, 10)}.` : success);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-medium">Billing</h2>
        <div className="flex items-center gap-2">
          <BillingStatePill state={billing.state} />
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="border-border hover:bg-muted rounded-md border px-2.5 py-1 text-xs transition-colors"
          >
            {editing ? 'Cancel' : billing.planId ? 'Change plan' : 'Set up billing'}
          </button>
        </div>
      </div>

      {/* Directly above the plan controls, so answering the request and
          closing it are the same visit. */}
      <CompanyUpgradeRequest request={upgradeRequest ?? null} />

      <dl className="divide-border grid grid-cols-2 divide-x text-sm sm:grid-cols-4">
        <Field label="Plan" value={billing.planName ?? 'None'} />
        <Field
          label="Amount"
          value={
            billing.amountMinor !== null
              ? `${formatMinor(billing.amountMinor, currency)}/${billing.planInterval === 'year' ? 'yr' : 'mo'}`
              : '—'
          }
        />
        <Field label="Renews" value={billing.periodEnd?.slice(0, 10) ?? '—'} />
        <Field
          label="Paid to date"
          value={
            billing.paidTotal.length
              ? billing.paidTotal.map((t) => formatMinor(t.amountMinor, t.currency)).join(' · ')
              : '—'
          }
        />
      </dl>

      {editing && (
        <div className="border-border bg-muted/30 space-y-3 border-t p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 basis-44 text-xs">
              <span className="mb-1 block font-medium">Plan</span>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              >
                <option value="">No plan</option>
                {plans
                  .filter((p) => p.isActive || p.id === billing.planId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatMinor(p.amountMinor, p.currency)}/
                      {p.interval === 'year' ? 'yr' : 'mo'}
                      {p.isActive ? '' : ' (retired)'}
                    </option>
                  ))}
              </select>
            </label>

            <label className="basis-32 text-xs">
              <span className="mb-1 block font-medium">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              >
                <option value="trialing">Trialing</option>
                <option value="active">Active</option>
                <option value="canceled">Canceled</option>
              </select>
            </label>

            <label className="basis-32 text-xs">
              <span className="mb-1 block font-medium">
                Price override
                <span className="text-muted-foreground font-normal"> (optional)</span>
              </span>
              <input
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                inputMode="decimal"
                placeholder="plan price"
                className="border-border bg-background w-full rounded-md border px-2.5 py-1.5 text-sm tabular-nums"
              />
            </label>

            <label className="basis-40 text-xs">
              <span className="mb-1 block font-medium">Renews on</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="border-border bg-background w-full rounded-md border px-2.5 py-1.5 text-sm"
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                send(
                  `/api/operator/companies/${slug}/billing`,
                  {
                    planId: planId || null,
                    status,
                    amount: override,
                    periodEnd: periodEnd ? new Date(periodEnd).toISOString() : null,
                  },
                  'Billing updated.'
                ).then(() => setEditing(false))
              }
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="text-muted-foreground text-xs">
            Leave the price override empty to charge the plan&apos;s own price.
          </p>
        </div>
      )}

      {/* ---- record a payment ---- */}
      <div className={`border-border border-t p-4 ${owed ? 'bg-amber-500/5' : ''}`}>
        <p className="mb-3 text-sm font-medium">Record a payment</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="basis-32 text-xs">
            <span className="mb-1 block font-medium">Amount ({currency})</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="border-border bg-background w-full rounded-md border px-2.5 py-1.5 text-sm tabular-nums"
            />
          </label>

          <label className="basis-36 text-xs">
            <span className="mb-1 block font-medium">Method</span>
            <input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. MoMo, bank"
              className="border-border bg-background w-full rounded-md border px-2.5 py-1.5 text-sm"
            />
          </label>

          <label className="flex-1 basis-40 text-xs">
            <span className="mb-1 block font-medium">Reference</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="what it shows as on the statement"
              className="border-border bg-background w-full rounded-md border px-2.5 py-1.5 text-sm"
            />
          </label>

          <label className="mb-1.5 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={extend}
              onChange={(e) => setExtend(e.target.checked)}
              className="accent-primary h-3.5 w-3.5"
            />
            Extend the period
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              send(
                `/api/operator/companies/${slug}/payments`,
                { amount, currency, method, reference, extendPeriod: extend },
                'Payment recorded.'
              )
            }
            className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {busy ? 'Recording…' : 'Record'}
          </button>
        </div>

        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        {notice && <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
      </div>

      {billing.payments.length > 0 && (
        <div className="border-border border-t">
          <ul className="divide-border divide-y text-sm">
            {billing.payments.slice(0, 6).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2">
                <span className="text-muted-foreground w-24 shrink-0 text-xs">
                  {p.paidAt.slice(0, 10)}
                </span>
                <span className="font-medium tabular-nums">
                  {formatMinor(p.amountMinor, p.currency)}
                </span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                  {[p.method, p.reference].filter(Boolean).join(' · ')}
                </span>
                <span className="text-muted-foreground text-xs">
                  {p.provider ?? p.recordedByName ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}
