-- ============================================================
-- 080_contact_is_business.sql — mark a contact as someone you do business with
--
-- A linked WhatsApp number is a PERSONAL number. Family, friends and the
-- group chat arrive in the inbox next to actual customers, and there is
-- no way to tell the CRM which is which — so the one screen the business
-- lives in fills up with conversations that have nothing to do with it.
--
-- This is a manual, human judgement, and it has to be: nothing in a
-- message distinguishes a customer from a cousin.
--
-- NOT the same thing as `business_profile`, which is already on this
-- table. That one is WhatsApp's own data — whether the CONTACT runs a
-- WhatsApp Business account — and it answers a different question. A
-- customer is usually an ordinary personal account, and a relative might
-- well run a shop, so using it as a proxy here would get both cases
-- exactly backwards.
--
-- Defaults to false rather than null: "not marked as business" and "not
-- yet decided" are the same thing to every query that matters, and a
-- nullable boolean would make every filter carry a three-state check for
-- no benefit.
-- ============================================================

alter table public.contacts
  add column if not exists is_business boolean not null default false;

comment on column public.contacts.is_business is
  'Manually marked as a business contact by a member of this account. '
  'Distinct from business_profile, which is WhatsApp''s own record of the '
  'contact running a Business account.';

-- The inbox filters conversations by this, always scoped to one account.
-- Partial: only the marked rows are ever selected by the filter, and in a
-- personal number''s contact list those are the minority.
create index if not exists contacts_is_business_idx
  on public.contacts (account_id)
  where is_business;
