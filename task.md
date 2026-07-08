# WhatsApp Parity Roadmap — remaining features

Goal: implement everything Baileys / Evolution / WAHA expose so users never
leave WhatsApp for the CRM. Method: for each item, check the provider source
first, test the endpoint live against Evolution, then build UI. Commit +
`docker compose up -d --build app` per feature.

Approach key: **[WIRE]** = Evolution REST already exposes it, just add
provider fn + route + UI. **[PATCH]** = Baileys has it but Evolution's REST
doesn't → extend the patched Evolution image. **[WAHA]** = only WAHA covers
it (would need a WAHA sidecar).

---

### ⚠️ Finding: account-level IQ writes destabilize the socket
Live-tested 2026-07-08 — calling `/chat/updatePrivacySettings` (even a single
VALID payload) drops the WhatsApp socket into a close→connecting reconnect
loop that only a `docker restart wacrm_evolution_api` recovers. Same failure
class as interactive buttons. **Message SENDS are safe; account-level IQ
writes (privacy, and likely profile-photo/settings) are NOT.** So:
`fetchPrivacySettings` (read) is fine; the WRITE is a dead end on this stack.

## Tier 1 — Evolution-native (no patching)
- [ ] **Video notes (PTV)** — round video messages. `/message/sendPtv`. Composer option. SAFE (message send). [WIRE] ← NEXT
- [ ] **Business catalog (read)** — view a contact's / own products + collections. `/business/getCatalog`, `/business/getCollections`. READ-only = safe, but our test numbers aren't Business accounts (getCatalog → isBusiness:false, no products) so nothing to show yet. Build when there's a Business number. [WIRE]
- [ ] **Own profile picture** — set + remove. `updateProfilePicture` unwired. ⚠️ account-level op — must be live-tested for the same socket-drop before shipping; hold until verified safe. [WIRE, risky]
- [ ] ~~Privacy settings (change)~~ — ❌ CONFIRMED non-viable (write drops the socket). Read-only display possible but low value.
- [ ] niche: emit call (`/call/offer`), per-number proxy (`/proxy/*`), WAVOIP token setting. [WIRE, low priority]

### ✅ RESOLVED: Evolution now builds from source (code-level patching)
Superseded the minified-bundle string-patch. The compose `evolution-api`
service now builds `FROM ../evolution-api` (our fork ElormCodes1/evolution-api,
pinned 2.3.7 — the exact running version). Every patch is a normal TS edit in
that repo's `src/`, `tsc + tsup` validates on build, and a failed build never
touches the running container. The old receipt/seen-by string-hack is ported
to source. Rebuild: `docker compose up -d --build evolution-api`.
Confirmed safe: pin/mute/star endpoints all use Baileys `chatModify` (same
class as archive) — tested live, socket stays `open` (unlike privacy/buttons).

## Tier 2 — patch Evolution (now via source build — see RESOLVED above)
- [x] **WhatsApp-synced pin / mute / star** — ✅ DONE. New Evolution endpoints `/chat/pinChat|muteChat|starMessage` (source, chatModify) + provider wrappers; pin/mute mirror in conversation-action route, star mirror via `/api/whatsapp/message/star`. On top of the existing CRM-local behavior.

- [x] **Chat actions: pin + mute** — ✅ DONE **CRM-local** (migration 042: pinned_at/muted_until; thread menu; pinned-first sort; greyed unread + mute icon). WhatsApp-phone mirror (chatModify pin/mute via a bundle patch) deferred — brittle, and CRM-queue organization is arguably better done CRM-side anyway.
- [x] **Star messages** — ✅ DONE **CRM-local** (migration 043: messages.starred_at; star in the message hover toolbar; ⭐ indicator on the bubble; findable "Starred" section in the contact sidebar).
- [x] **Delete chat** — ✅ DONE **CRM-local** (thread ⋮ "Delete chat" → conversation-action 'delete' → hard delete; messages+reactions cascade off the FK; deselects via onBack). Chat stays on the phone's WhatsApp.
- [x] **In-conversation search** — ✅ DONE (Search icon in the thread header → search bar with match count + up/down navigation; scrolls to & highlights each match). Client-side over loaded messages.
- [ ] **🏪 Store / catalog management** (commerce moat) — product create/edit/delete, edit business profile (hours/category/website/address), cover photo, order details. Only in Baileys → patch Evolution. [PATCH]
- [x] **Channels / Newsletters** — ✅ DONE. Evolution `/newsletter/*` module (create/metadata/follow/unfollow/mute/update/delete, dedicated router, source-built, socket-safe). App: `channels` table (migration 044) + provider wrappers + routes + **Channels page** (create, broadcast/post, add-by-link, copy link, edit, delete). Create WORKS end-to-end after fixing a **baileys 7.0.0-rc.9 bug** (parseNewsletterCreateResponse crashed on null picture) via **patch-package** (`patches/baileys+7.0.0-rc.9.patch`, applied on postinstall — Dockerfile copies patches/ before npm ci). Note: create *is* allowed on these numbers — the earlier "declined" was this parse bug, not a gate.
- [x] **Communities** — ✅ DONE. Evolution `/community/*` module (create/metadata/fetchAll/linkedGroups/link/unlink/update/inviteCode/leave, source-built, socket-safe). App: `communities` table (migration 045) + provider wrappers + routes + **Communities page** (create, edit, copy invite, leave, link/unlink your groups). Create returns GroupMetadata — verified live end-to-end, no parse issues. (join-request approvals not yet.)
- [ ] **Chat actions** — pin/unpin chat, mute, star/unstar message, clear chat, delete chat, disappearing-messages default, pin message. Baileys chatModify. (Have: archive/hide/mark-unread.) [PATCH]
- [ ] **Group join-request approvals** — approve/reject pending members (`group.join-request` event). [PATCH]
- [ ] **Live presence** — show a contact's online / "typing…" / last-seen in the inbox. `presenceSubscribe` + handle inbound `presence.update` (currently ignored in webhook). (Have: outbound typing only.) [PATCH/partial]
- [ ] **Rich message types** — live location, view-once media, albums, event/calendar invites, keep-in-chat. [PATCH]

## WAHA-only extras (need WAHA sidecar; deprioritized)
- [ ] Custom link previews, poll-vote API, native scheduled Events (RSVP), session screenshots, server-side media conversion, LID↔phone mapping endpoints.

## Excluded — verified dead ends (DO NOT build)
- Interactive **buttons / lists** — nativeFlow closes the WhatsApp socket on Baileys (tested: broke the number until a container restart). Keep the numbered-text fallback.
- **Outbound calls** and **Meta WABA templates** — protocol-impossible on Baileys.

---

## Done (for reference)
- ✅ Full group management (create/admin/members/invites/settings/leave)
- ✅ Avatar + name auto-refresh on profile change
- ✅ Delete status
- (earlier) send/receive text/media/voice-notes/reactions/edit/unsend/forward/receipts, Status + voice + "seen by", broadcasts, snippets, automations, flows, multi-number, labels↔tags, avatars, business-profile read, call logging, archive/block, history import, number validation.
