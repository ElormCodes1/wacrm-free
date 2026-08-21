"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UsersRound } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { CompanyBrandMark } from "@/components/tenancy/company-brand-mark";
import { sanitiseCompanyHint, LAST_COMPANY_COOKIE } from "@/lib/tenancy/last-company";
import { companyPath } from "@/lib/tenancy/routes";

/** The company remembered on this device, if the value still looks like a slug. */
function readLastCompanyCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LAST_COMPANY_COOKIE}=([^;]*)`)
  );
  return sanitiseCompanyHint(match ? decodeURIComponent(match[1]) : null);
}

export interface Branding {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  status: "active" | "suspended";
}

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export function LoginForm({ branding }: { branding: Branding | null }) {
  return (
    <Suspense fallback={null}>
      <LoginPageInner branding={branding} />
    </Suspense>
  );
}

function LoginPageInner({ branding }: { branding: Branding | null }) {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");

  // Which company this sign-in belongs to: the address first, then the
  // cookie left by the last successful sign-in on this device. Both are
  // sanitised — a hint decides only which logo to paint, so a bad one
  // must degrade to the generic form rather than break the page.
  // Kept for the sign-in POST only; branding arrives from the server.
  void readLastCompanyCookie;


  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data: signIn, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // HARD navigations from here, not router.push.
    //
    // Signing in changes what the server renders for every route, but the
    // App Router keeps a client-side cache of trees it has already
    // fetched — including ones built while nobody was signed in. A soft
    // navigation can therefore land on a page rendered for a logged-out
    // visitor and bounce straight back to /login, which looks exactly like
    // "the session did not stick".
    //
    // It only shows up once deployed: that cache is effectively disabled
    // in dev and real in a production build. Every sign-OUT path in this
    // app already forces a full load for the same reason; sign-in was the
    // one that did not.
    if (inviteToken) {
      window.location.assign(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      // Where to land is resolved from the account, not from the hint in
      // the address: the hint decides branding only, and trusting it here
      // would let a link choose someone's destination.
      const { data: profile } = await supabase
        .from("profiles")
        .select("account:accounts(slug)")
        .eq("user_id", signIn.user?.id ?? "")
        .maybeSingle();
      const account = Array.isArray(profile?.account)
        ? profile?.account[0]
        : profile?.account;
      const slug = (account as { slug?: string } | undefined)?.slug;
      if (slug) {
        // Remember for next time this device sees an expired session.
        document.cookie =
          `${LAST_COMPANY_COOKIE}=${encodeURIComponent(slug)}; path=/; ` +
          `max-age=${60 * 60 * 24 * 365}; samesite=lax` +
          // Only over TLS. The value is a company slug rather than a
          // secret, but there is no reason to let it travel in clear.
          (window.location.protocol === "https:" ? "; secure" : "");
        window.location.assign(companyPath(slug, "dashboard"));
      } else {
        window.location.assign("/");
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          {inviteToken ? (
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <UsersRound className="h-6 w-6 text-primary" />
            </div>
          ) : branding ? (
            <CompanyBrandMark branding={branding} size="lg" />
          ) : (
            <BrandLogo className="mb-2 h-12 w-12" />
          )}
          <CardTitle className="text-xl text-foreground">
            {inviteToken ? "Sign in to accept" : "Welcome back"}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {inviteToken
              ? "Sign in and we'll take you to the invitation."
              : "Sign in to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-muted-foreground">
                  Password
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary hover:text-primary/80"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href={
                inviteToken
                  ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                  : "/signup"
              }
              className="text-primary hover:text-primary/80"
            >
              Create account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
