'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { KeyRound } from 'lucide-react';
import { BrandLogo } from '@/components/layout/brand-logo';

/**
 * Set a new password after following a reset link.
 *
 * forgot-password has been sending people here since long before the page
 * existed. The link itself is the proof of identity — following it
 * establishes a short-lived session, and that session is what allows the
 * password to be changed. So there is no "current password" field: the
 * person using this page is, by definition, the one who could not supply
 * it.
 *
 * Which means the session check matters more than usual. Arriving here
 * WITHOUT one means the link expired, was already used, or somebody
 * typed the URL — and in each case the honest answer is to send them back
 * for a fresh link rather than showing a form that cannot work.
 */
export default function ResetPasswordPage() {
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setHasSession(Boolean(data.session));
      setChecking(false);
    })();
  }, [supabase]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Those two passwords are not the same');
      return;
    }
    if (password.length < 6) {
      setError('Use at least 6 characters');
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    // Where they belong, resolved from the session rather than from
    // anything in the link. A full load, because the session changed.
    const { data: session } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from('profiles')
      .select('account:accounts(slug)')
      .eq('user_id', session.user?.id ?? '')
      .maybeSingle();
    const account = Array.isArray(profile?.account) ? profile?.account[0] : profile?.account;
    const slug = (account as { slug?: string } | undefined)?.slug;
    window.location.assign(slug ? `/${slug}/dashboard` : '/');
  };

  if (checking) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Checking your link…</p>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4">
        <Card className="border-border bg-card w-full max-w-md">
          <CardHeader className="items-center text-center">
            <BrandLogo className="mb-2 h-12 w-12" />
            <CardTitle className="text-foreground text-xl">This link has expired</CardTitle>
            <CardDescription className="text-muted-foreground">
              Reset links can only be used once, and not long after they are sent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/forgot-password"
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-10 w-full items-center justify-center rounded-md text-sm font-medium transition-colors"
            >
              Send a new link
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            <KeyRound className="text-primary h-6 w-6" />
          </div>
          <CardTitle className="text-foreground text-xl">Choose a new password</CardTitle>
          <CardDescription className="text-muted-foreground">
            You will be signed in once it is saved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">
                New password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm" className="text-muted-foreground">
                Confirm password
              </Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat it"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? 'Saving…' : 'Save and sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
