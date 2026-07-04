'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SyncLabelsButton } from './sync-labels-button';
import { ImportHistoryButton } from './import-history-button';

interface Settings {
  rejectCall?: boolean;
  msgCall?: string;
  alwaysOnline?: boolean;
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 flex-shrink-0"
      />
    </label>
  );
}

/**
 * Behaviour toggles for the connected number: auto-reject calls (with an
 * optional auto-reply), and keep the number shown as online.
 */
export function WhatsAppSettingsCard() {
  const [s, setS] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/whatsapp/settings')
      .then((r) => r.json())
      .then((d) => setS(d.settings ?? {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save(next: Settings) {
    setS(next);
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const d = await res.json();
        toast.error(d.error ?? 'Save failed');
        return;
      }
      toast.success('Settings saved');
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Behaviour {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </CardTitle>
        <CardDescription>How the connected number handles calls and presence.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Toggle
          label="Auto-reject incoming calls"
          desc="WhatsApp voice/video calls are declined automatically."
          checked={!!s.rejectCall}
          onChange={(v) => save({ ...s, rejectCall: v })}
        />
        {s.rejectCall && (
          <Input
            placeholder="Auto-reply after rejecting (optional)"
            value={s.msgCall ?? ''}
            onChange={(e) => setS({ ...s, msgCall: e.target.value })}
            onBlur={() => save(s)}
          />
        )}
        <Toggle
          label="Always show as online"
          desc="Keep the number's presence set to online while connected."
          checked={!!s.alwaysOnline}
          onChange={(v) => save({ ...s, alwaysOnline: v })}
        />
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <SyncLabelsButton />
          <ImportHistoryButton />
        </div>
      </CardContent>
    </Card>
  );
}
