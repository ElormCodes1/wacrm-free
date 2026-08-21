-- ============================================================
-- 081_onboarding_state.sql — remember whether someone has been shown around
--
-- A new workspace opens on a dashboard of zeroes, with fourteen things in
-- the sidebar and no indication that none of them do anything until a
-- WhatsApp number is linked. The one step that matters is invisible, and
-- the step after it — scan the code from INSIDE WhatsApp, not with the
-- camera — is the one people reliably get wrong.
--
-- Two columns rather than one boolean, because "finished the tour" and
-- "closed it, leave me alone" are different states and want different
-- treatment: the first is done, the second should still be resumable from
-- a menu without nagging on every visit.
--
-- Timestamps rather than flags: knowing WHEN someone was onboarded is
-- worth having when a support conversation starts with "I never saw
-- that", and it costs nothing over a boolean.
--
-- On profiles, not accounts. Being shown around is a property of a
-- PERSON: an invited teammate joining an established workspace has never
-- seen the product either, and an account-level flag would mark them as
-- onboarded by someone else's action.
-- ============================================================
-- Wrapped in a transaction. Postgres DDL is transactional, so if any
-- statement below fails the whole migration rolls back and the schema is
-- exactly as it was — no half-applied state to reason about at 2am.

begin;

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_skipped_at timestamptz;

comment on column public.profiles.onboarding_completed_at is
  'When this person finished the welcome walkthrough. NULL means they have '
  'not — including every profile predating migration 081, which is correct: '
  'they have not seen it.';

comment on column public.profiles.onboarding_skipped_at is
  'When this person dismissed the walkthrough. Distinct from completing it — '
  'the guide stays available from the help menu rather than reappearing.';

commit;
