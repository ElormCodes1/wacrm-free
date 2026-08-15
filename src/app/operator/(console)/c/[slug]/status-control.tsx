'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Suspend or reactivate, from the company page.
 *
 * Suspension locks the customer out of every table on their next request,
 * mid-session, while they are working — so the control is deliberately
 * slow to operate: it opens a form rather than firing on click, requires
 * the company name typed back, and requires a reason.
 *
 * The server enforces all of that independently. This form makes the
 * requirements visible; it does not make them true.
 *
 * Reactivating is a single button. Restoring access is the safe
 * direction, and friction in front of undoing a mistake only makes the
 * outage longer.
 */
export function StatusControl({
  slug,
  name,
  status,
  members,
}: {
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  members: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(next: 'active' | 'suspended') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/companies/${slug}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, reason, confirmName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong');
        return;
      }
      setOpen(false);
      setConfirmName('');
      setReason('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status === 'suspended') {
    return (
      <section className="border-border bg-card rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Reactivate</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Restores access immediately for all {members} {members === 1 ? 'member' : 'members'}.
        </p>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => submit('active')}
          className="mt-3 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Reactivating…' : 'Reactivate this company'}
        </button>
      </section>
    );
  }

  return (
    <section className="bg-card rounded-lg border border-red-500/30 p-4">
      <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Suspend</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Locks all {members} {members === 1 ? 'member' : 'members'} out of every page on their next
        request — not when their session expires. Their address keeps working and explains that the
        company is suspended.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-md border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
        >
          Suspend this company…
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="reason" className="mb-1 block text-xs font-medium">
              Reason (recorded, and shown to whoever asks later)
            </label>
            <input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. non-payment, 3 invoices overdue"
              className="border-border bg-background focus:ring-ring w-full rounded-md border px-2.5 py-1.5 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="confirm" className="mb-1 block text-xs font-medium">
              Type <span className="font-mono">{name}</span> to confirm
            </label>
            <input
              id="confirm"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              className="border-border bg-background focus:ring-ring w-full rounded-md border px-2.5 py-1.5 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => submit('suspended')}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Suspending…' : 'Suspend'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
