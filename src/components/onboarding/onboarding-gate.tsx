'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { WelcomeGuide } from './welcome-guide';

/**
 * Decides whether to show the walkthrough, and remembers the answer.
 *
 * Separate from the guide itself so the guide stays a dumb, testable
 * component that renders steps — and so the "have they seen it" question
 * has exactly one home.
 *
 * The state lives on the profile rather than in localStorage: signing in
 * on a second device is not a reason to be onboarded again, and clearing
 * a browser is not a reason to lose the fact that you were.
 */
export function OnboardingGate() {
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('id, onboarding_completed_at, onboarding_skipped_at')
        .eq('user_id', user.id)
        .maybeSingle();

      // An un-migrated database errors here. Show nothing rather than
      // popping a dialog that cannot record having been seen — that would
      // greet the same person on every single page load.
      if (error || !data || cancelled) return;

      setProfileId(data.id as string);

      // ?guide=1 reopens it on demand — that is what the "Show
      // walkthrough" menu item links to, and what makes the guide's own
      // promise that you can come back to it true.
      //
      // Read off window rather than useSearchParams: this component is
      // mounted inside a page that would then need a Suspense boundary
      // for prerendering, and a query string does not warrant that.
      const requested =
        new URLSearchParams(window.location.search).get('guide') === '1';

      if (
        requested ||
        (!data.onboarding_completed_at && !data.onboarding_skipped_at)
      ) {
        setOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const record = useCallback(
    async (column: 'onboarding_completed_at' | 'onboarding_skipped_at') => {
      // Close first. The write is not what the person is waiting for, and
      // a dialog that lingers through a round trip feels stuck.
      setOpen(false);
      if (!profileId) return;
      const supabase = createClient();
      await supabase
        .from('profiles')
        .update({ [column]: new Date().toISOString() })
        .eq('id', profileId);
    },
    [profileId],
  );

  if (!open) return null;

  return (
    <WelcomeGuide
      open={open}
      onComplete={() => record('onboarding_completed_at')}
      onSkip={() => record('onboarding_skipped_at')}
    />
  );
}
