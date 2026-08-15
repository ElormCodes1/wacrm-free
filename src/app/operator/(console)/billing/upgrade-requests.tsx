'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowUpCircle } from 'lucide-react';

import type { UpgradeRequest } from '@/lib/operator/billing';

/**
 * Customers waiting to be moved up.
 *
 * Rendered only when there are any: a permanently visible "0 requests"
 * card is a thing you learn to stop looking at, and this is the one queue
 * where the items are people offering money.
 *
 * Both buttons close the request. Declining is a real outcome rather than
 * an omission — leaving a request open because the answer was no means
 * the queue slowly fills with decisions that have already been made.
 */
export function UpgradeRequests({ requests }: { requests: UpgradeRequest[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function resolve(id: string, status: 'done' | 'declined') {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch('/api/operator/upgrade-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not close that request');
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border-primary/30 bg-primary-soft overflow-hidden rounded-lg border">
      <div className="border-primary/20 flex items-center gap-2 border-b px-4 py-2.5">
        <ArrowUpCircle className="text-primary h-4 w-4" />
        <h2 className="text-sm font-medium">
          {requests.length} upgrade {requests.length === 1 ? 'request' : 'requests'}
        </h2>
      </div>

      {error && <p className="px-4 pt-3 text-sm text-red-500">{error}</p>}

      <ul className="divide-primary/15 divide-y">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <span className="min-w-0 flex-1">
              <Link
                href={`/operator/c/${r.companySlug}`}
                className="hover:text-primary block truncate text-sm font-medium transition-colors"
              >
                {r.companyName}
              </Link>
              <span className="text-muted-foreground block truncate text-xs">
                {r.reason ? `Hit their ${r.reason} limit` : 'Asked to upgrade'}
                {r.requestedByName ? ` · ${r.requestedByName}` : ''} ·{' '}
                {new Date(r.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </span>

            <Link
              href={`/operator/c/${r.companySlug}`}
              className="border-border bg-background hover:bg-muted rounded-md border px-2.5 py-1 text-xs transition-colors"
            >
              Open company
            </Link>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => resolve(r.id, 'done')}
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {busy === r.id ? '…' : 'Mark done'}
            </button>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => resolve(r.id, 'declined')}
              className="border-border hover:bg-muted text-muted-foreground rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The same thing on a single company's page, where the plan is actually
 * changed — so closing the request does not mean navigating back to find
 * it.
 */
export function CompanyUpgradeRequest({ request }: { request: UpgradeRequest | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!request) return null;

  async function resolve(status: 'done' | 'declined') {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/upgrade-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id, status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not close that request');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-primary/30 bg-primary-soft flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <ArrowUpCircle className="text-primary h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Asked to upgrade</span>
        <span className="text-muted-foreground">
          {request.reason ? ` — hit their ${request.reason} limit` : ''}
          {request.requestedByName ? ` (${request.requestedByName})` : ''}
        </span>
        {error && <span className="mt-1 block text-red-500">{error}</span>}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => resolve('done')}
        className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
      >
        {busy ? '…' : 'Mark done'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => resolve('declined')}
        className="border-border hover:bg-muted text-muted-foreground rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
      >
        Decline
      </button>
    </div>
  );
}
