'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function OperatorSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/operator/logout', { method: 'POST' });
        router.replace('/operator/login');
        router.refresh();
      }}
      className="border-border hover:bg-muted rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
