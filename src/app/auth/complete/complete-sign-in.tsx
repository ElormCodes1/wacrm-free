'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { BrandLogo } from '@/components/layout/brand-logo';

export function CompleteSignIn() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const hashError = hash.get('error_description');

      if (hashError) {
        setError(hashError);
        return;
      }

      // No tokens anywhere. Someone opened this page directly, or the link
      // was already used — the sign-in page is the honest destination.
      if (!accessToken || !refreshToken) {
        window.location.replace('/login');
        return;
      }

      const supabase = createClient();
      const { data, error: setError_ } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (setError_ || !data.session) {
        setError(setError_?.message ?? 'That link is no longer valid.');
        return;
      }

      // Only relative destinations: an absolute one in a crafted link
      // would carry a freshly minted session off our domain.
      const next = searchParams.get('next');
      if (next && next.startsWith('/') && !next.startsWith('//')) {
        window.location.replace(next);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('account:accounts(slug)')
        .eq('user_id', data.session.user.id)
        .maybeSingle();
      const account = Array.isArray(profile?.account) ? profile?.account[0] : profile?.account;
      const slug = (account as { slug?: string } | undefined)?.slug;

      // A full load, not a router push: everything the server renders
      // changes now that there is a session.
      window.location.replace(slug ? `/${slug}/dashboard` : '/');
    })();
  }, [searchParams]);

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <BrandLogo className="mx-auto h-10 w-10" />
        {error ? (
          <>
            <h1 className="text-foreground mt-4 text-lg font-semibold">
              That link didn&apos;t work
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">{error}</p>
            <a
              href="/login"
              className="bg-primary text-primary-foreground hover:bg-primary-hover mt-5 inline-flex h-10 items-center rounded-lg px-5 text-sm font-semibold transition-colors"
            >
              Go to sign in
            </a>
          </>
        ) : (
          <p className="text-muted-foreground mt-4 text-sm">Signing you in…</p>
        )}
      </div>
    </main>
  );
}
