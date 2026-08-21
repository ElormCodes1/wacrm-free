-- ============================================================
-- 083_first_linked_at.sql — when a number was FIRST linked, and stays that way
--
-- A newly linked number should start clean: the CRM picks up from the
-- moment it was connected, and nothing before it. Getting that right needs
-- a timestamp for "when was this number linked" that does not move.
--
-- connected_at cannot be it. It is rewritten to now() every time a health
-- probe finds the socket open (see /api/whatsapp/config and .../qr), so it
-- means "last seen connected", not "linked". Used as a history cutoff it
-- would creep forward to the present and start discarding the RECONNECT
-- BACKLOG — messages sent while the socket was down, which arrive under
-- the same event as old history and are the one part of it worth keeping.
-- Silent message loss, from a change meant to save disk.
--
-- created_at is not it either: it records when the row was made, which is
-- when somebody opened the QR screen. Scan it a week later and a week of
-- history becomes fair game again.
--
-- So: a column written exactly once, by a trigger rather than by the four
-- code paths that mark a number connected. A trigger cannot be forgotten
-- by the fifth one somebody adds later.
-- ============================================================

begin;

alter table public.whatsapp_config
  add column if not exists first_linked_at timestamptz;

comment on column public.whatsapp_config.first_linked_at is
  'When this number first paired. Written once and never updated — unlike '
  'connected_at, which tracks the most recent successful health probe. Used '
  'as the cutoff for how much history a link ingests.';

-- Backfill: the best evidence available for numbers linked before this
-- existed. connected_at is right for a currently-connected number, and
-- created_at is the closest thing for one that has drifted — both are
-- better than NULL, which would read as "never linked" and let old
-- history back in for existing tenants.
update public.whatsapp_config
   set first_linked_at = coalesce(connected_at, created_at)
 where first_linked_at is null;

create or replace function public.set_first_linked_at()
returns trigger
language plpgsql
as $$
begin
  -- Once only. coalesce keeps whatever is already recorded, so a
  -- reconnect, a restart or a re-probe can never move the cutoff forward
  -- and start discarding backlog.
  if new.connection_state = 'open' and new.first_linked_at is null then
    new.first_linked_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_config_first_linked_at on public.whatsapp_config;

create trigger whatsapp_config_first_linked_at
  before insert or update on public.whatsapp_config
  for each row
  execute function public.set_first_linked_at();

commit;
