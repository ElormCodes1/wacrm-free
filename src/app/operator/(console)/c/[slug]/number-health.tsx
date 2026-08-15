'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CompanyNumberHealth } from '@/lib/operator/companies';

/**
 * One customer's WhatsApp number, with a probe/restart button.
 *
 * The stored state shown here is what the health sweep last wrote, and
 * the whole reason this button exists is that it can be wrong: Evolution's
 * socket dies while still reporting "open", so a number can read as
 * connected while every inbound message is being dropped. Checking means
 * probing for real.
 *
 * The button says "Check" rather than "Restart" because that is what it
 * does first. A healthy socket is left alone — restarting one drops a
 * working connection and turns a support call into an outage.
 */
export function NumberHealth({ slug, number }: { slug: string; number: CompanyNumberHealth }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const connected = number.connectionState === 'open';

  async function check() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/operator/companies/${slug}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numberId: number.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailed(true);
        setResult(body.error ?? 'Could not reach the gateway');
        return;
      }
      setFailed(!body.alive);
      setResult(body.message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-sm">{number.label || 'Unlabelled'}</span>

        <span
          className={`text-xs ${
            connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {number.connectionState ?? number.status ?? 'unknown'}
        </span>

        <button
          type="button"
          disabled={busy}
          onClick={check}
          className="border-border hover:bg-muted rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Check / restart'}
        </button>
      </div>

      {number.lastError && (
        <p className="text-muted-foreground mt-1 truncate text-xs">
          Last gateway error: {number.lastError}
        </p>
      )}

      {result && (
        <p
          className={`mt-1.5 text-xs ${
            failed ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
          }`}
        >
          {result}
        </p>
      )}
    </li>
  );
}
