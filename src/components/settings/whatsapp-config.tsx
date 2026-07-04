'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  Smartphone,
  QrCode,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Plus,
  Pencil,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import { WhatsAppProfileCard } from './whatsapp-profile-card';
import { WhatsAppSettingsCard } from './whatsapp-settings-card';

interface QrPayload {
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
}

interface NumberRow {
  id: string;
  label: string | null;
  connection_state: string;
  phone_info: { display_phone_number: string | null; verified_name: string | null } | null;
}

const POLL_INTERVAL_MS = 3000;

/**
 * WhatsApp numbers — self-hosted Evolution API backend.
 *
 * An account can link several WhatsApp numbers; each is its own Evolution
 * instance. Adding a number returns a QR to scan (Linked Devices). We poll
 * for a fresh QR (it rotates ~every 30s) until the number goes `open`.
 * Replies go out from the number a conversation is on. No Meta account.
 */
export function WhatsAppConfig() {
  const { accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [numbers, setNumbers] = useState<NumberRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // QR flow for the number currently being linked.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [busy, setBusy] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadNumbers = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/config');
      const data = await res.json();
      setNumbers(Array.isArray(data.numbers) ? data.numbers : []);
    } catch {
      setNumbers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!accountId) {
      setLoading(false);
      return;
    }
    loadNumbers();
  }, [accountId, authLoading, profileLoading, loadNumbers]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Poll a specific number's QR until it links.
  const startPolling = useCallback(
    (numberId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/whatsapp/config/qr?number_id=${numberId}`);
          const data = await res.json();
          if (!res.ok) return;
          if (data.state === 'open') {
            stopPolling();
            setPendingId(null);
            setQr(null);
            toast.success('WhatsApp number connected!');
            await loadNumbers();
            return;
          }
          if (data.qrcode) setQr(data.qrcode);
        } catch {
          /* keep polling */
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, loadNumbers],
  );

  const addNumber = useCallback(async () => {
    const label = window.prompt('Name this number (e.g. "Sales line"):')?.trim();
    if (label === undefined) return; // cancelled
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Failed to add number.');
        toast.error(data.error ?? 'Failed to add number.');
        return;
      }
      await loadNumbers();
      setPendingId(data.number_id);
      setQr(data.qrcode ?? null);
      startPolling(data.number_id);
    } catch {
      setErrorMsg('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [loadNumbers, startPolling]);

  const connectNumber = useCallback(
    async (numberId: string) => {
      setPendingId(numberId);
      setQr(null);
      startPolling(numberId);
    },
    [startPolling],
  );

  const renameNumber = useCallback(
    async (numberId: string, current: string | null) => {
      const label = window.prompt('Rename this number:', current ?? '')?.trim();
      if (label === undefined) return;
      try {
        const res = await fetch('/api/whatsapp/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number_id: numberId, label }),
        });
        if (!res.ok) {
          toast.error('Rename failed');
          return;
        }
        await loadNumbers();
      } catch {
        toast.error('Could not reach the server.');
      }
    },
    [loadNumbers],
  );

  const removeNumber = useCallback(
    async (numberId: string, label: string | null) => {
      if (
        !window.confirm(
          `Remove ${label || 'this number'}? It unlinks the device and deletes the connection.`,
        )
      )
        return;
      try {
        const res = await fetch('/api/whatsapp/config', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number_id: numberId }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? 'Failed to remove.');
          return;
        }
        if (pendingId === numberId) {
          stopPolling();
          setPendingId(null);
          setQr(null);
        }
        toast.success('Number removed.');
        await loadNumbers();
      } catch {
        toast.error('Could not reach the server.');
      }
    },
    [loadNumbers, pendingId, stopPolling],
  );

  const anyConnected = numbers.some((n) => n.connection_state === 'open');

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WhatsApp numbers"
        description="Link one or more WhatsApp numbers by scanning a QR code. Powered by your self-hosted Evolution API — no Meta Business account required."
      />

      <div className="mx-auto max-w-2xl space-y-6">
        {errorMsg && (
          <Alert className="border-red-600/40 bg-red-950/30">
            <AlertTriangle className="size-4" />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Linked numbers</CardTitle>
                <CardDescription>
                  {numbers.length === 0
                    ? 'No numbers linked yet.'
                    : `${numbers.length} number${numbers.length === 1 ? '' : 's'} linked.`}
                </CardDescription>
              </div>
              <Button size="sm" onClick={addNumber} disabled={busy || !accountId}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add number
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {numbers.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Click “Add number” to link your first WhatsApp number.
                </p>
              )}
              {numbers.map((n) => {
                const connected = n.connection_state === 'open';
                return (
                  <div
                    key={n.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Smartphone
                        className={`size-7 shrink-0 ${connected ? 'text-emerald-500' : 'text-muted-foreground'}`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {n.label || 'Untitled number'}
                          </span>
                          {connected ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-500">
                              <CheckCircle2 className="size-3" /> Connected
                            </span>
                          ) : (
                            <span className="text-xs text-amber-500">Not connected</span>
                          )}
                        </div>
                        {connected && n.phone_info?.display_phone_number && (
                          <div className="truncate font-mono text-sm text-muted-foreground">
                            +{n.phone_info.display_phone_number}
                            {n.phone_info.verified_name ? ` · ${n.phone_info.verified_name}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!connected && pendingId !== n.id && (
                        <Button variant="outline" size="sm" onClick={() => connectNumber(n.id)}>
                          <QrCode className="size-4" />
                          Scan QR
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => renameNumber(n.id, n.label)}
                        aria-label="Rename number"
                      >
                        <Pencil className="size-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeNumber(n.id, n.label)}
                        aria-label="Remove number"
                      >
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* QR panel for the number being linked. */}
        {pendingId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="size-5 text-primary" />
                Scan to connect
              </CardTitle>
              <CardDescription>
                Open WhatsApp on your phone →{' '}
                <strong>Settings → Linked Devices → Link a Device</strong> → scan this code. It
                refreshes automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl bg-white p-4">
                  {qr?.base64 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qr.base64}
                      alt="WhatsApp QR code"
                      width={264}
                      height={264}
                      className="size-[264px]"
                    />
                  ) : (
                    <div className="flex size-[264px] items-center justify-center">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                {qr?.pairingCode && (
                  <div className="text-center text-sm text-muted-foreground">
                    Or link with phone number using code:{' '}
                    <span className="font-mono text-base text-foreground">{qr.pairingCode}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className="size-3.5 animate-spin" />
                  Waiting for scan…
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  stopPolling();
                  setPendingId(null);
                  setQr(null);
                }}
              >
                Cancel
              </Button>
            </CardContent>
          </Card>
        )}

        {anyConnected && (
          <>
            <WhatsAppProfileCard />
            <WhatsAppSettingsCard />
          </>
        )}

        {numbers.length === 0 && !loading && (
          <Alert className="border-amber-600/40 bg-amber-950/20">
            <AlertTriangle className="size-4" />
            <AlertTitle>Use a number you can afford to lose</AlertTitle>
            <AlertDescription>
              This connects through an unofficial WhatsApp client. It works well, but WhatsApp
              does not sanction it — there is a small risk of a number being flagged. Prefer a
              dedicated business number over a personal one.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  );
}
