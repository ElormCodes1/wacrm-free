'use client';

import { useState } from 'react';
import { ArrowUpCircle, Check } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { formatMinor } from '@/lib/billing/money';
import { usePlanUsage, atLimit } from '@/lib/billing/use-plan-usage';

/**
 * "You've reached what your plan includes."
 *
 * Deliberately a prompt and not a wall. Nothing here prevents the action
 * the customer came to do — a hard gate fires at the exact moment
 * somebody is trying to grow their use of the product, which is the worst
 * possible moment to stop them, and turns a sales conversation into an
 * error message. They see what they are on, what it includes, and a way
 * to ask for more.
 *
 * The button records a request rather than taking payment, because there
 * is no payment processor and a button that appears to charge and does
 * not is worse than an honest one. The operator sees it in the console
 * and moves them across.
 */
export function UpgradePrompt({
  reason,
  title,
  body,
  className = '',
}: {
  /** Which ceiling prompted this — recorded so we know what to discuss. */
  reason: 'numbers' | 'members' | 'storage' | 'broadcasts' | 'api';
  title: string;
  body: string;
  className?: string;
}) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id, full_name, user_id')
        .maybeSingle();
      if (!profile?.account_id) {
        setError('Could not identify your company. Please contact support.');
        return;
      }

      const { error: insertError } = await supabase.from('upgrade_requests').insert({
        account_id: profile.account_id,
        reason,
        requested_by: profile.user_id,
        requested_by_name: profile.full_name,
      });

      // A duplicate means they already have one open, which is the state
      // they wanted to be in. Telling them it "failed" would make them
      // think nobody heard.
      if (insertError && insertError.code !== '23505') {
        setError(insertError.message);
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`border-primary/30 bg-primary-soft flex flex-wrap items-start gap-3 rounded-lg border p-4 ${className}`}
    >
      <ArrowUpCircle className="text-primary mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-1 text-sm">{body}</p>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </div>

      {sent ? (
        <span className="text-primary inline-flex shrink-0 items-center gap-1.5 text-sm font-medium">
          <Check className="h-4 w-4" />
          We&apos;ll be in touch
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={request}
          className="bg-primary text-primary-foreground hover:bg-primary-hover shrink-0 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Request an upgrade'}
        </button>
      )}
    </div>
  );
}

/**
 * The prompt for a specific ceiling, shown only when it applies.
 *
 * Renders nothing while loading, on no plan, and when they are within
 * their limits — so a caller can drop it in unconditionally without
 * wrapping it in a check of its own.
 *
 * The conditions differ by kind on purpose. Numbers and members fire when
 * they are AT the ceiling, because the offer has to arrive before they
 * try to add the thing. Storage and broadcasts fire only once OVER,
 * because nobody can plan a voice note they have not received yet. The
 * API fires on the plan flag alone, since that one is genuinely blocked.
 */
export function LimitPrompt({
  kind,
  className,
}: {
  kind: 'numbers' | 'members' | 'storage' | 'broadcasts' | 'api';
  className?: string;
}) {
  const { usage } = usePlanUsage();
  if (!usage) return null;
  const u = usage;

  const price =
    u.amountMinor !== null && u.currency
      ? ` (${formatMinor(u.amountMinor, u.currency)}/${u.interval === 'year' ? 'yr' : 'mo'})`
      : '';

  if (kind === 'api') {
    if (u.allowApi) return null;
    return (
      <UpgradePrompt
        reason="api"
        className={className}
        title={`The REST API is not included in your ${u.planName} plan`}
        body={`Keys created here will be refused${price}. Ask us about a plan that includes API access.`}
      />
    );
  }

  if (kind === 'storage') {
    const breach = u.breaches.find((b) => b.kind === 'storage');
    if (!breach) return null;
    return (
      <UpgradePrompt
        reason="storage"
        className={className}
        title={`You are over the media storage your ${u.planName} plan includes`}
        body={`${breach.text}${price}. Nothing has been deleted and messages keep arriving — we'll get in touch about more room.`}
      />
    );
  }

  if (kind === 'broadcasts') {
    const breach = u.breaches.find((b) => b.kind === 'broadcasts');
    if (!breach) return null;
    return (
      <UpgradePrompt
        reason="broadcasts"
        className={className}
        title={`You have sent more broadcasts than your ${u.planName} plan includes`}
        body={`${breach.text}${price}. High volume on a personal WhatsApp number risks it being banned, so let's talk about the right plan.`}
      />
    );
  }

  if (!atLimit(u, kind)) return null;

  if (kind === 'numbers') {
    return (
      <UpgradePrompt
        reason="numbers"
        className={className}
        title={`Your ${u.planName} plan includes ${u.maxNumbers} WhatsApp ${u.maxNumbers === 1 ? 'number' : 'numbers'}`}
        body={`You have ${u.numbers} connected${price}. You can still add more — we'll get in touch about moving you to a plan that covers them.`}
      />
    );
  }

  return (
    <UpgradePrompt
      reason="members"
      className={className}
      title={`Your ${u.planName} plan includes ${u.maxMembers} team ${u.maxMembers === 1 ? 'member' : 'members'}`}
      body={`You have ${u.members}${price}. Inviting more still works — we'll get in touch about the right plan.`}
    />
  );
}
