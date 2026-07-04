'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Edit the connected number's own WhatsApp display name and "about" text.
 */
export function WhatsAppProfileCard({ initialName }: { initialName?: string }) {
  const [name, setName] = useState(initialName ?? '');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          status: status.trim() ? status.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Update failed');
        return;
      }
      toast.success('WhatsApp profile updated');
      setStatus('');
    } catch {
      toast.error('Update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp profile</CardTitle>
        <CardDescription>
          Your public display name and “about” text on WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="wa-name">Display name</Label>
          <Input
            id="wa-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your business name"
          />
        </div>
        <div>
          <Label htmlFor="wa-about">About (status)</Label>
          <Input
            id="wa-about"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="e.g. Open Mon–Fri, 9–5"
          />
        </div>
        <Button onClick={save} disabled={saving} size="sm">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save profile
        </Button>
      </CardContent>
    </Card>
  );
}
