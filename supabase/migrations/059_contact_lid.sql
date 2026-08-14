-- ============================================================
-- 059_contact_lid.sql — contacts we only know by LID
--
-- WhatsApp increasingly addresses people by an opaque LID and shares the
-- phone number only once you have some history with them. For a stranger
-- in a group — exactly the person you most need to look up — there may be
-- no number available from any source: not the chat, not the message
-- history, not the group's member list.
--
-- Until now those messages were parked in pending_lid_events: preserved,
-- but invisible. Parking is the right holding pattern for a binding that
-- is about to arrive; it is the wrong permanent home for a conversation
-- that is happening right now. WhatsApp itself shows these people by name
-- and lets you reply — and so can we, because Evolution's createJid passes
-- an `@lid` address through untouched, so a LID chat is fully sendable.
--
-- `phone` stays NOT NULL (a generated phone_normalized and a unique index
-- depend on it), so a LID-only contact stores the LID's digits there as a
-- placeholder and keeps the real address in `lid`. Anything that needs to
-- ADDRESS the contact must prefer `lid` — the digits are not a phone
-- number and must never be dialled or sent to as one.
--
-- When the real number later turns up, `phone` is updated and `lid` stays
-- as the link back; if that collides with an existing contact for the same
-- number, merge_duplicate_contacts() (022) collapses them.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lid TEXT;

COMMENT ON COLUMN contacts.lid IS
  'Full WhatsApp LID JID (<id>@lid) when the contact is addressed by LID. '
  'When set and phone is still the LID placeholder, use this to send.';

-- One contact per LID per account, mirroring the phone_normalized guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_lid
  ON contacts (account_id, lid)
  WHERE lid IS NOT NULL;

NOTIFY pgrst, 'reload schema';
