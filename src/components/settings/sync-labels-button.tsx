'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Pull WhatsApp Business labels into CRM tags. Afterwards, labelling a
 * chat on the phone flows into the CRM as a tag automatically.
 */
export function SyncLabelsButton() {
  const [busy, setBusy] = useState(false);
  async function sync() {
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/labels/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Sync failed');
        return;
      }
      toast.success(
        data.created > 0
          ? `Synced ${data.created} new label${data.created === 1 ? '' : 's'} as tags`
          : `Labels up to date (${data.total} linked)`,
      );
    } catch {
      toast.error('Sync failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={sync} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Tags className="size-4" />}
      Sync WhatsApp labels → tags
    </Button>
  );
}
