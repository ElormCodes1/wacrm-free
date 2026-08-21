"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { emailLinkOrigin } from "@/lib/app-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { previewSlug, isUsableSlug } from "@/lib/tenancy/slugify";
import { formatMinor } from "@/lib/billing/money";
import type { PublicPlan } from "@/lib/billing/public-plans";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle, UsersRound } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";

export function SignupForm({
  plans,
  appOrigin,
}: {
  plans: PublicPlan[];
  appOrigin?: string | null;
}) {
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get("invite");
  // A pricing card sends the plan it represents. Validated against the
  // plans we actually rendered, so a hand-edited query string selects
  // nothing rather than something arbitrary — and the trigger checks it
  // again server-side regardless.
  const requestedPlan = searchParams.get("plan");

  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const slugPreview = previewSlug(companyName);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [planId, setPlanId] = useState<string>(
    plans.find((p) => p.id === requestedPlan)?.id ?? plans[0]?.id ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    // If we have an invite token, point Supabase's verification
    // email back at the join page so the user can accept after
    // verifying. Without a token, Supabase uses its default
    // redirect (the app root).
    // Always come back through /auth/callback. Without this Supabase
    // falls back to the Site URL — the landing page — which creates no
    // Supabase client, so the token in the link is never read and the
    // visitor is silently not signed in.
    const origin = emailLinkOrigin(appOrigin);
    const emailRedirectTo = inviteToken
      ? `${origin}/auth/callback?next=${encodeURIComponent(`/join/${inviteToken}`)}`
      : `${origin}/auth/callback`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          // The address is derived from this, server-side.
          company_name: companyName,
          // A hint only. The trigger checks it against billing_plans and
          // ignores anything that is not a real, currently-offered plan —
          // this value comes from the browser like everything else here.
          ...(planId ? { plan_id: planId } : {}),
        },
        emailRedirectTo,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Check your email
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              We&apos;ve sent a confirmation link to{" "}
              <span className="text-foreground">{email}</span>. Please check your
              inbox and click the link to verify your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
            >
              <Button
                variant="outline"
                className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Back to sign in
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          {inviteToken ? (
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <UsersRound className="h-6 w-6 text-primary" />
            </div>
          ) : (
            <BrandLogo className="mb-2 h-12 w-12" />
          )}
          <CardTitle className="text-xl text-foreground">
            {inviteToken ? "Create account & join" : "Create account"}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {inviteToken
              ? "Verify your email, then accept the invitation to join your team."
              : "Get started with WaCRM"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="companyName" className="text-muted-foreground">
                Company name
              </Label>
              <Input
                id="companyName"
                type="text"
                placeholder="Bright Motors"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
              {/* Show the address as they type. It is permanent once issued
                  and it is what they will print, so discovering it later is
                  how people end up with one they would not have chosen. */}
              <p className="text-muted-foreground text-xs">
                {slugPreview && isUsableSlug(slugPreview) ? (
                  <>
                    Your address will be{" "}
                    <code className="text-foreground font-mono">/{slugPreview}</code>
                    . This cannot be changed later.
                  </>
                ) : (
                  "Your team will reach the system at this name."
                )}
              </p>
            </div>

            {/* Plans, when there are any. With none configured this whole
                section is absent and signup is exactly as it was — which is
                the state the app ships in, so it must not look broken. */}
            {plans.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label className="text-muted-foreground">Plan</Label>
                <div className="grid gap-2">
                  {plans.map((plan) => {
                    const selected = plan.id === planId;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setPlanId(plan.id)}
                        aria-pressed={selected}
                        className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-muted hover:border-primary/40"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="text-foreground block truncate text-sm font-medium">
                            {plan.name}
                          </span>
                        </span>
                        <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
                          {formatMinor(plan.amountMinor, plan.currency)}
                          <span className="text-muted-foreground font-normal">
                            /{plan.interval === "year" ? "yr" : "mo"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* Said plainly because it is true: there is no card field on
                    this form and none appears later in the flow. Implying a
                    charge that never happens is how a signup becomes a
                    support ticket. */}
                <p className="text-muted-foreground text-xs">
                  No payment is taken now — you will be invoiced.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-muted-foreground">
                Full name
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

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
              <Label htmlFor="password" className="text-muted-foreground">
                Password
              </Label>
              <PasswordInput
                id="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword" className="text-muted-foreground">
                Confirm password
              </Label>
              <PasswordInput
                id="confirmPassword"
                fieldLabel="confirm password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Creating account..." : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
              className="text-primary hover:text-primary/80"
            >
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
