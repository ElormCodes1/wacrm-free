'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldCheck, ShieldAlert, KeyRound, Copy } from 'lucide-react';

/**
 * Two-factor setup and password change.
 *
 * The secret is shown as text rather than a QR code. Every authenticator
 * app supports typing a key by hand, this happens once per operator, and
 * the alternative is a QR-encoding dependency in the most sensitive path
 * in the system — which is a poor trade for saving twenty seconds once.
 *
 * Recovery codes are displayed once, at the only moment they exist in
 * plaintext, with the consequence spelled out. Presenting them as an
 * optional extra is how somebody closes the tab and locks themselves out
 * of the platform they run.
 */
export function SecurityPanel({
  enrolled,
  recoveryCodesLeft,
}: {
  enrolled: boolean;
  recoveryCodesLeft: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [disablePassword, setDisablePassword] = useState('');

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/operator/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong');
        return null;
      }
      return json;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---------- two-factor ---------- */}
      <section className="border-border bg-card overflow-hidden rounded-lg border">
        <div className="border-border flex items-center gap-2.5 border-b px-4 py-2.5">
          {enrolled ? (
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-amber-500" />
          )}
          <h2 className="flex-1 text-sm font-medium">Two-factor authentication</h2>
          <span className={enrolled ? 'text-xs text-emerald-500' : 'text-xs text-amber-500'}>
            {enrolled ? 'on' : 'off'}
          </span>
        </div>

        <div className="space-y-4 p-4">
          {enrolled ? (
            <>
              <p className="text-muted-foreground text-sm">
                A code from your authenticator is required at sign-in.{' '}
                {recoveryCodesLeft > 0
                  ? `${recoveryCodesLeft} recovery ${recoveryCodesLeft === 1 ? 'code' : 'codes'} left.`
                  : 'No recovery codes left — turn two-factor off and on again to get a new set.'}
              </p>

              <div className="border-border space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Turn it off</p>
                <p className="text-muted-foreground text-xs">
                  Your password alone would then open every company on the platform.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Current password"
                    className="border-border bg-background flex-1 rounded-md border px-2.5 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const r = await post({
                        action: 'disable-2fa',
                        currentPassword: disablePassword,
                      });
                      if (r?.ok) {
                        setDisablePassword('');
                        router.refresh();
                      }
                    }}
                    className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                  >
                    Turn off
                  </button>
                </div>
              </div>
            </>
          ) : recoveryCodes ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Two-factor is on. Save these recovery codes now.
              </p>
              <p className="text-muted-foreground text-sm">
                Each one works once, in place of a code from your phone. They are shown here
                and nowhere else — if you lose your authenticator without them, nobody can
                get you back in except by editing the database directly.
              </p>
              <div className="border-border bg-muted/40 grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-sm">
                {recoveryCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(recoveryCodes.join('\n'));
                    setNotice('Copied.');
                  }}
                  className="border-border hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecoveryCodes(null);
                    router.refresh();
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                >
                  I have saved them
                </button>
              </div>
            </div>
          ) : secret ? (
            <div className="space-y-3">
              <p className="text-sm">
                Add this key to your authenticator app, then enter the code it shows.
              </p>
              <div className="border-border bg-muted/40 rounded-md border p-3">
                <p className="font-mono text-lg tracking-wider break-all">
                  {secret.replace(/(.{4})/g, '$1 ').trim()}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Time-based, 6 digits, 30 seconds — the defaults in every app.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="6-digit code"
                  className="border-border bg-background w-36 rounded-md border px-2.5 py-1.5 text-sm tabular-nums"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const r = await post({ action: 'confirm-2fa', code });
                    if (r?.recoveryCodes) {
                      setRecoveryCodes(r.recoveryCodes);
                      setSecret(null);
                      setCode('');
                    }
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {busy ? 'Checking…' : 'Confirm'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                Right now your password alone opens every company&apos;s data on this
                platform.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const r = await post({ action: 'begin-2fa' });
                  if (r?.secret) setSecret(r.secret);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {busy ? 'Starting…' : 'Set up two-factor'}
              </button>
            </>
          )}
        </div>
      </section>

      {/* ---------- password ---------- */}
      <section className="border-border bg-card overflow-hidden rounded-lg border">
        <div className="border-border flex items-center gap-2.5 border-b px-4 py-2.5">
          <KeyRound className="text-muted-foreground h-4 w-4" />
          <h2 className="text-sm font-medium">Password</h2>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="border-border bg-background flex-1 basis-48 rounded-md border px-2.5 py-1.5 text-sm"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (12+ characters)"
              className="border-border bg-background flex-1 basis-48 rounded-md border px-2.5 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const r = await post({
                  action: 'change-password',
                  currentPassword,
                  newPassword,
                });
                if (r?.ok) {
                  setCurrentPassword('');
                  setNewPassword('');
                  setNotice('Password changed.');
                }
              }}
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Change'}
            </button>
          </div>
          <p className="text-muted-foreground text-xs">
            Twelve characters minimum here, rather than the six customers get — this one
            opens every company.
          </p>
        </div>
      </section>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
    </div>
  );
}
