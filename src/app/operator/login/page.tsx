'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Loader2 } from 'lucide-react';

/**
 * The operator entrance.
 *
 * Visually distinct from the customer sign-in on purpose: an operator
 * should never be in doubt about which plane they are entering, and a
 * customer who lands here should see immediately that it is not for them.
 */
export default function OperatorLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Set once the server says this account has a second factor. The form
  // then asks for the code instead of re-asking for the password.
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(code ? { code } : {}) }),
      });
      const json = await res.json();

      // The password was right and a second factor is required. Deliberately
      // a 200 with a flag rather than an error: nothing has gone wrong, and
      // treating it as a failure would show "Sign-in failed" to somebody who
      // typed everything correctly.
      if (json.mfaRequired && res.ok) {
        setNeedsCode(true);
        return;
      }
      if (!res.ok) {
        if (json.mfaRequired) setNeedsCode(true);
        throw new Error(json.error ?? 'Sign-in failed');
      }
      router.replace('/operator');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="bg-foreground text-background mx-auto flex h-12 w-12 items-center justify-center rounded-xl">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">Operator sign-in</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Staff access across all companies. Actions are recorded.
          </p>
        </div>

        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="border-border w-full rounded-md border px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="border-border w-full rounded-md border px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        {needsCode && (
          <div>
            <label htmlFor="operator-code" className="mb-1 block text-sm font-medium">
              Authenticator code
            </label>
            <input
              id="operator-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="6 digits"
              className="border-border bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-sm tabular-nums focus:ring-2 focus:outline-none"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Or one of your recovery codes.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-foreground text-background flex h-10 w-full items-center justify-center rounded-md text-sm font-medium disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
