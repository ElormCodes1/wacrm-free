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
- [x] **Video notes (PTV)** — ✅ DONE. Round "video note" (self-playing, no scrubber on the recipient's phone). Evolution `/message/sendPtv` (verified live — real ptvMessage sent, socket stayed `open` → SAFE). provider `sendPtv()` + `/api/whatsapp/send-ptv` route (persists content_type='video'; the recipient's client draws it round) + composer **Video note** attach-menu item (uploads a video to chat-media, staged round with no caption, routed to the PTV endpoint) + inbound `ptvMessage`→video in the webhook adapter (was dropped). content_type stays 'video' — no migration. [WIRE]
- [ ] **Business catalog (read)** — view a contact's / own products + collections. `/business/getCatalog`, `/business/getCollections`. READ-only = safe, but our test numbers aren't Business accounts (getCatalog → isBusiness:false, no products) so nothing to show yet. Build when there's a Business number. [WIRE]
- [x] ~~**Own profile picture**~~ — ❌ CONFIRMED NON-VIABLE (live-tested 2026-07-08, reverted). `updateProfilePicture` AND `removeProfilePicture` return 200 `{"update":"success"}` and the picture DOES change, BUT they push the instance into a `stream:error` **`conflict: replaced`** reconnect loop (CONNECTED→conflict→reconnect, repeating) — sends fail with "Connection Closed"/500, `connectionState` misleadingly still reads `open`, and it only recovers via `docker restart wacrm_evolution_api`. Same severity class as the privacy write. Shipping it would let a user brick their number by setting an avatar. name/about (updateProfileName/Status) stay fine — only the PICTURE IQ is toxic. DO NOT build.
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
- [x] **🏪 Store / catalog management** — ✅ DONE (forward-compatible). Extended Evolution `/business` with createProduct/updateProduct/deleteProduct + `/business/profile` (own, incl. isBusiness), source-built, socket-safe. App: provider wrappers + `/api/whatsapp/store` routes + **Store page** (view catalog, add/edit/delete products). ⚠️ Product CRUD needs a **WhatsApp Business** number — on the personal numbers WhatsApp returns `not-acceptable` (no catalog). The page shows an isBusiness banner and is fully functional the moment a Business number is connected. (Order details / business-profile editing not yet.)
- [x] **Channels / Newsletters** — ✅ DONE. Evolution `/newsletter/*` module (create/metadata/follow/unfollow/mute/update/delete, dedicated router, source-built, socket-safe). App: `channels` table (migration 044) + provider wrappers + routes + **Channels page** (create, broadcast/post, add-by-link, copy link, edit, delete). Create WORKS end-to-end after fixing a **baileys 7.0.0-rc.9 bug** (parseNewsletterCreateResponse crashed on null picture) via **patch-package** (`patches/baileys+7.0.0-rc.9.patch`, applied on postinstall — Dockerfile copies patches/ before npm ci). Note: create *is* allowed on these numbers — the earlier "declined" was this parse bug, not a gate.
- [x] **Communities** — ✅ DONE. Evolution `/community/*` module (create/metadata/fetchAll/linkedGroups/link/unlink/update/inviteCode/leave, source-built, socket-safe). App: `communities` table (migration 045) + provider wrappers + routes + **Communities page** (create, edit, copy invite, leave, link/unlink your groups). Create returns GroupMetadata — verified live end-to-end, no parse issues. (join-request approvals not yet.)
- [~] **Chat actions** — pin/unpin chat ✅, mute ✅, star/unstar message ✅, clear chat, delete chat ✅, disappearing-messages default (1:1 messy — Baileys only does groups; group ephemeral already available), ~~pin message~~ ✅. Baileys chatModify. [PATCH]
  - [x] **Pin message (pin-in-chat)** — ✅ DONE. Pin an important message in a conversation (order confirmation, meeting link) — mirrored to WhatsApp so the contact sees it pinned too. [PATCH] Evolution fork: `POST /message/pinMessage` (Baileys `pinInChatMessage`; type 1=pin w/ 24h/7d/30d duration, 2=unpin; sent directly via `client.sendMessage` as a message add-on). Socket-SAFE — verified live (pin + unpin → 201, `PIN_FOR_ALL`, socket stayed open, follow-up text OK). App: provider `pinMessage`, `/api/whatsapp/message/pin` (resolves the WA key like the star route, default 7-day), migration `048` (messages.pinned_until), Pin/Unpin in the message hover toolbar + 📌 indicator on pinned bubbles (expiry-aware). (Inbound pin echo + a pinned-banner not wired — follow-up.)
- [x] **Group join-request approvals** — ✅ DONE. [PATCH] Extended our Evolution fork with `/group/pendingParticipants` (list) + `/group/updatePendingParticipant` (approve/reject) — Baileys `groupRequestParticipantsList`/`groupRequestParticipantsUpdate`, socket-SAFE (group IQ, verified live: list returns 200 + socket stays open). Requester JIDs (may be @lid) pass through to Baileys unchanged. App: provider `fetchGroupPendingParticipants`/`updateGroupPendingParticipants` + `/api/whatsapp/group/[groupId]/requests` GET+POST + a **Join requests** section in group-info-panel (owner-only, Approve/Reject per requester). (Realtime `group.join-request` event forwarding not wired — the panel pulls on open; a follow-up could push it.)
- [x] **Live presence** — ✅ DONE. Shows the contact's **online / "typing…" / recording… / last seen** under their name in the thread header. Turned out to be a pure **[WIRE]**, not a patch: Evolution already auto-subscribes to a contact's presence when they message us and forwards Baileys `presence.update` (it was even already in DEFAULT_WEBHOOK_EVENTS — just dropped by the webhook's default case). migration `046_contact_presence.sql` (one row per contact, RLS select by is_account_member, added to the realtime publication) + webhook `handlePresenceUpdate` (upsert state+last_seen, never creates a contact, skips groups) + `use-contact-presence` hook (Realtime sub + typing/online staleness expiry, reuses formatLastSeen) + thread-header line (teal "typing…"). Distinct from the CRM-teammate presence (024). Verified live via synthetic events (composing→row, unavailable+lastSeen→last-seen, unknown-contact→no row). Follow-up idea: surface "typing…" in the conversation list too.
- [~] **Rich message types** — live location, ~~view-once media~~ ✅, ~~albums~~ ✅, ~~event/calendar invites~~ ✅, keep-in-chat. [PATCH]
  - [x] **Albums** — ✅ DONE. Send 2+ photos/videos as one grouped WhatsApp album (product galleries). [PATCH] Evolution fork: `POST /message/sendAlbum`. GOTCHA: the bundled Baileys **rc.9 has no high-level `{ album }` helper** (workspace Baileys is rc13) — but rc.9's PROTO fully supports it (`albumMessage`, `MessageAssociation.MEDIA_ALBUM`). So built against the proto: relay an `albumMessage` header, then relay each media item (via the existing `prepareMediaMessage`) tagged with a `messageContextInfo.messageAssociation {associationType: MEDIA_ALBUM, parentMessageKey: header.key}`. Socket-SAFE — verified live (header + 2 items each w/ messageContextInfo, socket open). App: provider `sendAlbum`, `/api/whatsapp/send-album` (persists each item as its own image/video message), **Album** dialog in composer attach menu (multi-select up to 10, uploads each to chat-media, grid preview, send). Verified live.
  - [x] **Event / calendar invites** — ✅ DONE. Send a native WhatsApp event (RSVP) to a contact — e.g. schedule an onboarding call. [PATCH] Evolution fork: `POST /message/sendEvent` (Baileys `eventMessage`), routing high-level `{event}` through `sendMessageWithTyping` (added `!message['event']` to the forward-branch guard so it falls through to `client.sendMessage`). Socket-SAFE — verified live: event send → `messageType:eventMessage`, socket stayed open + a follow-up text send succeeded (NOT nativeFlow, unlike buttons). App: provider `sendEvent`, `/api/whatsapp/send-event`, an **Event** dialog in the composer attach menu (name/start/end/location/description; venue folded into the description since there's no geocoding), migration `047` (content_type += 'event'), an event-card bubble, and inbound capture (webhook `adaptMessage` unwraps `eventMessage` → content_type='event' with a shared `formatEventSummary`; was dropped). Verified live both ways.
  - [x] **View-once media** — ✅ DONE. Send photos/videos that disappear after the recipient opens them once. [PATCH] Added an optional `viewOnce` flag to Evolution's `SendMediaDto`/`mediaMessageSchema`; `mediaMessage()` wraps the content in `{viewOnceMessage:{message}}` (mirrors Baileys). Socket-SAFE (verified live: send returned `messageType:viewOnceMessage`, socket stayed open). App: `viewOnce` threaded through provider `sendMedia` → `SendMessageParams` → `/api/whatsapp/send` (`view_once`), + a **View once** toggle (eye "1" pill) on image/video drafts in the composer. INBOUND also captured: webhook `adaptMessage` unwraps `viewOnceMessage[V2]` → inner image/video (was dropped); Evolution's media download unwraps it too (MessageSubtype). In the CRM the media is kept normally (a durable record — better than the phone, which deletes after one view). Remaining rich types (live location, albums, events, keep-in-chat) still open.

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
