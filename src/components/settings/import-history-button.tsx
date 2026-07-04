'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, History } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Pull the connected number's existing chats + recent messages into the
 * CRM inbox. Safe to re-run (dedupes).
 */
export function ImportHistoryButton() {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (
      !window.confirm(
        'Import your existing WhatsApp chats and recent messages into the inbox? This can take a minute for large accounts.',
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/history/import', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Import failed');
        return;
      }
      toast.success(
        `Imported ${data.chats} chats, ${data.contacts} new contacts, ${data.messages} messages`,
      );
    } catch {
      toast.error('Import failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />}
      Import chat history
    </Button>
  );
}
