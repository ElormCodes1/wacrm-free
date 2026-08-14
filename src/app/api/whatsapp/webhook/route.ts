import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getBase64FromMediaMessage,
  jidToPhone,
  resolveLid,
  learnLid,
  learnLidsFromKey,
  findContactByJid,
  fetchGroupInfo,
  fetchInstance,
} from '@/lib/whatsapp/provider/evolution'
import {
  resolveInstanceConfig,
  type InstanceConfig,
} from '@/lib/whatsapp/provider/config'
import { baseMime, storageExtension } from '@/lib/whatsapp/media-naming'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { formatEventSummary } from '@/lib/whatsapp/event-summary'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import {
  syncContactAvatar,
  syncContactProfile,
  storeAvatarFromUrl,
} from '@/lib/whatsapp/avatar'

// The `after()` callback runs within this route's max duration. Inbound
// processing can fan out to per-media downloads + storage uploads, so give
// it headroom beyond the platform default.
export const maxDuration = 60

// Lazy-initialized to avoid build-time crash when env vars are missing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

// ============================================================
// Evolution webhook envelope + Baileys message shapes
// ============================================================

interface EvolutionWebhookBody {
  event?: string
  instance?: string
  // The Baileys payload — shape depends on `event`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

/**
 * The internal, transport-neutral message shape that `processMessage` and
 * everything downstream consumes. Baileys messages are adapted into this
 * (previously it mirrored Meta's Cloud API message shape).
 */
interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { mime_type?: string; caption?: string }
  video?: { mime_type?: string; caption?: string }
  document?: { mime_type?: string; filename?: string; caption?: string }
  audio?: { mime_type?: string }
  sticker?: { mime_type?: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  event?: {
    name: string
    description?: string
    startTime?: number
    endTime?: number
    location?: { name?: string; address?: string }
  }
  reaction?: { message_id: string; emoji: string }
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  /** Set when the customer swipe-replies to one of our messages. */
  context?: { id: string }
  /** The raw Baileys message object — used to download media on demand. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _raw?: any
}

// ============================================================
// POST — receive Evolution events
// ============================================================

export async function POST(request: Request) {
  // Optional shared-secret auth. Evolution sends `x-evolution-secret` only
  // when EVOLUTION_WEBHOOK_SECRET is configured (see provider/config.ts).
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (secret) {
    const got = request.headers.get('x-evolution-secret')
    if (got !== secret) {
      console.warn('[webhook] rejected request with bad x-evolution-secret')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: EvolutionWebhookBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Ack immediately, process in the background — Evolution retries on slow
  // acks. `after()` (not a detached promise) keeps the serverless function
  // alive until the work completes.
  after(async () => {
    try {
      await processEvolutionEvent(body)
    } catch (error) {
      console.error('Error processing Evolution webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processEvolutionEvent(body: EvolutionWebhookBody) {
  const event = body.event
  const instance = body.instance
  if (!event || !instance) return

  // Harvest LID→phone bindings from every event before dispatching, no
  // matter which handler (if any) will deal with it. The pairing is only
  // ever present on messages WE send, so the events that teach us are
  // precisely the ones that need no resolving — including `send.message`,
  // which has no handler at all. Learning here means an inbound message
  // from the same chat resolves later without another network call.
  // asMessages, not asArray: messages.upsert wraps its payload as
  // `{ messages: [...] }`, and asArray would hand back that wrapper — an
  // object with no `key` — so every binding would be missed.
  for (const m of asMessages(body.data)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    learnLidsFromKey(instance, (m as any)?.key)
  }

  switch (event) {
    case 'messages.upsert':
    case 'messages.set':
      for (const msg of asMessages(body.data)) {
        await handleInboundMessage(instance, msg)
      }
      break

    case 'messages.update':
    case 'send.message.update':
      for (const upd of asArray(body.data)) {
        // A status revoke (poster deleted their status) — mirror WhatsApp
        // and remove it from our feed instead of treating it as an ack.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = upd as any
        if (
          u?.remoteJid === 'status@broadcast' &&
          String(u?.status).toUpperCase() === 'DELETED'
        ) {
          await handleStatusRevoke(instance, u)
          continue
        }
        await handleAck(upd)
      }
      break

    case 'message-receipt.update':
      await handleReceiptUpdate(instance, asArray(body.data))
      break

    case 'connection.update':
      await handleConnectionUpdate(instance, body.data)
      break

    case 'call':
      for (const call of asArray(body.data)) {
        await handleCall(instance, call)
      }
      break

    case 'labels.association':
      await handleLabelAssociation(instance, body.data)
      break

    case 'labels.edit':
      await handleLabelEdit(instance, body.data)
      break

    case 'contacts.update':
      await handleContactsUpdate(instance, body.data)
      break

    case 'presence.update':
      await handlePresenceUpdate(instance, body.data)
      break

    // qrcode.updated, contacts.upsert, send.message (our own echoes),
    // etc. — intentionally ignored here.
    default:
      break
  }
}

// ============================================================
// Contact profile updates (auto-refresh avatar + name)
//
// Baileys fires `contacts.update` (an ARRAY) when a contact changes their
// profile picture or name; Evolution enriches each entry with a freshly
// fetched `profilePicUrl`. The per-message single-object form of the same
// event is bookkeeping noise, so we act on the array form only.
// ============================================================
async function handleContactsUpdate(instanceName: string, data: unknown) {
  if (!Array.isArray(data)) return
  const config = await resolveConfig(instanceName)
  if (!config) return
  const db = supabaseAdmin()

  for (const raw of data) {
    const c = (raw ?? {}) as {
      remoteJid?: string
      pushName?: string
      profilePicUrl?: string
    }
    const jid = c.remoteJid ?? ''
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue
    const phone = normalizePhone(jidToPhone(jid))
    if (!phone) continue

    const existing = await findExistingContact(db, config.account_id, phone)
    if (!existing) continue

    // Picture: re-host the fresh URL. We only act when a URL is present — an
    // absent one can mean "removed" OR a transient fetch failure, so we
    // never clear an existing avatar on absence (avoids false wipes).
    if (c.profilePicUrl) {
      await storeAvatarFromUrl(db, existing.id, c.profilePicUrl)
    }

    // Name: fill gaps only — sync the pushName when we have no real name
    // yet (name is null or still equals the phone), but never clobber a name
    // someone edited in the CRM. The filter enforces that server-side.
    if (c.pushName) {
      await db
        .from('contacts')
        .update({ name: c.pushName, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .or(`name.is.null,name.eq.${phone}`)
    }
  }
}

// ============================================================
// Contact presence (online / typing… / last seen)
//
// Baileys' `presence.update` = { id, presences: { [jid]: PresenceData } }
// where PresenceData = { lastKnownPresence, lastSeen? }. Evolution
// auto-subscribes to a contact's presence when they message us and
// forwards this event — so this is a pure WIRE. We upsert one row per
// contact into contact_presence; the inbox renders it via Realtime.
// We never CREATE a contact from presence (only update presence for
// contacts we already know) and skip groups.
// ============================================================

type BaileysPresence = 'available' | 'unavailable' | 'composing' | 'recording' | 'paused'
const PRESENCE_STATES = new Set<BaileysPresence>([
  'available',
  'unavailable',
  'composing',
  'recording',
  'paused',
])

async function handlePresenceUpdate(instanceName: string, data: unknown) {
  const payload = (data ?? {}) as {
    id?: string
    presences?: Record<string, { lastKnownPresence?: string; lastSeen?: number }>
  }
  const jid = payload.id ?? ''
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return
  if (!payload.presences) return

  const phone = normalizePhone(jidToPhone(jid))
  if (!phone) return

  // The presences map is keyed by participant JID; for a 1:1 chat it's the
  // contact themselves. Take the entry matching `id`, else the first.
  const entry = payload.presences[jid] ?? Object.values(payload.presences)[0]
  const state = entry?.lastKnownPresence as BaileysPresence | undefined
  if (!state || !PRESENCE_STATES.has(state)) return

  const config = await resolveConfig(instanceName)
  if (!config) return
  const db = supabaseAdmin()

  const existing = await findExistingContact(db, config.account_id, phone)
  if (!existing) return

  const lastSeen =
    typeof entry?.lastSeen === 'number' && entry.lastSeen > 0
      ? new Date(entry.lastSeen * 1000).toISOString()
      : null

  // Upsert one row per contact. Only overwrite last_seen when this event
  // carried a fresh value — a `composing` ping usually has none and
  // shouldn't blank a previously reported last-seen.
  const row: Record<string, unknown> = {
    contact_id: existing.id,
    account_id: config.account_id,
    state,
    updated_at: new Date().toISOString(),
  }
  if (lastSeen) row.last_seen = lastSeen

  await db.from('contact_presence').upsert(row, { onConflict: 'contact_id' })
}

// ============================================================
// Group messages
//
// A group is stored as a contact (is_group=true, phone = group id); each
// message is attributed to the member who sent it (author_name/phone).
// ============================================================

const GROUP_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video', 'location', 'contact', 'poll',
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleGroupMessage(instanceName: string, data: any) {
  const key = data.key
  const groupJid: string = key.remoteJid
  const groupId = jidToPhone(groupJid)
  if (!groupId) return

  const config = await resolveConfig(instanceName)
  if (!config) return

  // Dedupe (our own send echoes + repeats).
  const { data: dup } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', key.id)
    .limit(1)
    .maybeSingle()
  if (dup) return

  // No name passed on purpose. A group's display name comes from
  // `fetchGroupInfo` below, not from the message — and passing `groupId`
  // here made every later group message look like a rename (groupId vs the
  // enriched subject), quietly resetting "The Dokosi Family" back to
  // "120363111718907840". Creation is unchanged: findOrCreateContact falls
  // back to `phone`, which for a group *is* groupId.
  const groupContact = await findOrCreateContact(
    config.account_id,
    config.user_id,
    groupId,
    '',
    true,
  )
  if (!groupContact) return

  // Enrich the group's name + picture from WhatsApp the first time we see
  // it — and again for any group still showing its raw id, which covers
  // both a failed first enrichment and the groups the rename bug above
  // already reset. Self-limiting: once a subject lands, this stops firing.
  if (groupContact.wasCreated || groupContact.contact.name === groupId) {
    const info = await fetchGroupInfo(instanceName, groupJid)
    if (info?.subject) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name: info.subject, updated_at: new Date().toISOString() })
        .eq('id', groupContact.contact.id)
    }
    if (info?.pictureUrl) {
      await storeAvatarFromUrl(supabaseAdmin(), groupContact.contact.id, info.pictureUrl)
    }
  }

  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    groupContact.contact.id,
    config.id,
  )
  if (!convResult) return

  // Attribute the message to the member who sent it.
  const authorPhone = key.fromMe
    ? null
    : normalizePhone(jidToPhone(key.participantAlt || key.participant || ''))
  const authorName = key.fromMe ? null : data.pushName || authorPhone || null

  const message = adaptMessage(data)
  const { contentText, mediaPending } = describeMessageContent(message)
  const contentType = GROUP_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  const { data: insertedRow, error: insErr } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: convResult.conversation.id,
      sender_type: key.fromMe ? 'agent' : 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: null,
      media_status: mediaPending ? 'pending' : null,
      message_id: key.id,
      author_name: authorName,
      author_phone: authorPhone,
      status: key.fromMe ? 'sent' : 'delivered',
      created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    })
    .select('id')
    .single()
  if (insErr) {
    console.error('Error inserting group message:', insErr)
    return
  }

  const preview = key.fromMe
    ? contentText || `[${message.type}]`
    : `${authorName ? `${authorName}: ` : ''}${contentText || `[${message.type}]`}`
  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      unread_count: key.fromMe
        ? convResult.conversation.unread_count || 0
        : (convResult.conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', convResult.conversation.id)

  if (mediaPending) {
    await backfillMessageMedia({
      rowId: insertedRow.id,
      instanceName,
      message,
    })
  }
}

// ============================================================
// Incoming calls → timeline log
// ============================================================

// A single call fires several near-simultaneous 'ringing' events (each a
// separate webhook POST). A DB check-then-insert races, so we also guard
// synchronously in-process: the first event to claim the id wins, the rest
// bail before any await. TTL-pruned.
const recentCallIds = new Map<string, number>()
function claimCallId(id: string): boolean {
  const now = Date.now()
  for (const [k, t] of recentCallIds) {
    if (now - t > 120_000) recentCallIds.delete(k)
  }
  if (recentCallIds.has(id)) return false
  recentCallIds.set(id, now)
  return true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCall(instanceName: string, call: any) {
  // Log once when the call starts (offer/ringing); ignore later
  // accept/reject/timeout events.
  const status = String(call?.status ?? '').toLowerCase()
  if (status && status !== 'offer' && status !== 'ringing') return
  const fromJid: string | undefined = call?.from
  if (!fromJid || fromJid.endsWith('@g.us')) return

  // Synchronous in-process dedupe BEFORE any await (beats the race).
  if (call?.id && !claimCallId(call.id)) return

  // Resolve LID callers to their real phone (via remoteJidAlt / findChats).
  const jid = await resolveJid(instanceName, { remoteJid: fromJid })
  if (!jid) return

  const config = await resolveConfig(instanceName)
  if (!config) return

  // Cross-process fallback dedupe (best-effort).
  if (call?.id) {
    const { data: dup } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('message_id', call.id)
      .limit(1)
      .maybeSingle()
    if (dup) return
  }

  const phone = normalizePhone(jidToPhone(jid))
  const contactOutcome = await findOrCreateContact(config.account_id, config.user_id, phone, '')
  if (!contactOutcome) return
  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contactOutcome.contact.id,
    config.id,
  )
  if (!convResult) return

  const label = call?.isVideo ? '📹 Incoming video call' : '📞 Incoming voice call'
  await supabaseAdmin().from('messages').insert({
    conversation_id: convResult.conversation.id,
    sender_type: 'customer',
    content_type: 'call',
    content_text: label,
    message_id: call?.id ?? null,
    status: 'delivered',
    created_at: new Date().toISOString(),
  })
  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: label,
      last_message_at: new Date().toISOString(),
      unread_count: (convResult.conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', convResult.conversation.id)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asArray(data: any): any[] {
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

/** messages.upsert `data` may be a single message, an array, or {messages:[]}. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asMessages(data: any): any[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.messages)) return data.messages
  return [data]
}

// ============================================================
// Unresolved-LID parking
//
// An inbound `<id>@lid` message carries no phone number, and the binding
// isn't always known yet. Rather than discard the message (the old
// `if (!jid) return`), park the raw event and replay it once the binding
// turns up — which the next outbound message to that chat supplies.
// ============================================================

/** Guard against a replay re-entering itself through a nested resolve. */
const replayingLids = new Set<string>()

async function parkUnresolvedLidEvent(
  instanceName: string,
  lid: string,
  // NOT NULL in the table — handleInboundMessage bails before this when
  // key.id is missing, so there is always one.
  messageId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
): Promise<void> {
  // onConflict on the partial unique index makes re-parking a no-op, so
  // Evolution's webhook retries can't pile up duplicates.
  const { error } = await supabaseAdmin()
    .from('pending_lid_events')
    .upsert(
      {
        instance_name: instanceName,
        lid,
        message_id: messageId,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'instance_name,message_id', ignoreDuplicates: true },
    )
  if (error) {
    console.error('[webhook] failed to park unresolved LID event:', error.message)
  }
}

/**
 * Replay everything parked against a LID that we can now resolve. Called
 * right after a successful resolve, so the backlog drains on the very
 * event that taught us the binding.
 */
async function replayPendingLidEvents(instanceName: string, lid: string): Promise<void> {
  if (!lid.endsWith('@lid')) return
  const guardKey = `${instanceName}|${lid}`
  if (replayingLids.has(guardKey)) return

  const { data: parked, error } = await supabaseAdmin()
    .from('pending_lid_events')
    .select('id, payload, attempts, message_id')
    .eq('instance_name', instanceName)
    .eq('lid', lid)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) {
    console.error('[webhook] failed to read parked LID events:', error.message)
    return
  }
  if (!parked?.length) return

  replayingLids.add(guardKey)
  try {
    console.log(`[webhook] replaying ${parked.length} parked message(s) for ${lid}`)
    for (const row of parked) {
      try {
        // Skip anything that reached the thread by another route in the
        // meantime — replaying it would duplicate the message. This check
        // is off the hot path: it only runs while draining a backlog.
        const { data: already } = await supabaseAdmin()
          .from('messages')
          .select('id')
          .eq('message_id', row.message_id)
          .limit(1)
          .maybeSingle()
        if (!already) {
          await handleInboundMessage(instanceName, row.payload)
        }
        // Delete only on success; a throw leaves the row for another pass.
        await supabaseAdmin().from('pending_lid_events').delete().eq('id', row.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[webhook] replay failed for parked event', row.id, message)
        await supabaseAdmin()
          .from('pending_lid_events')
          .update({
            attempts: (row.attempts ?? 0) + 1,
            last_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
      }
    }
  } finally {
    replayingLids.delete(guardKey)
  }
}

// ============================================================
// Inbound messages
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInboundMessage(instanceName: string, data: any) {
  const key = data?.key
  if (!key?.id || !key.remoteJid) return

  let jid: string = key.remoteJid
  if (jid.endsWith('@newsletter')) {
    return
  }
  // Status/Stories: contacts' (and our own) status posts. Own path — no
  // conversation, no flows/automations.
  if (jid === 'status@broadcast') {
    await handleStatusBroadcast(instanceName, data)
    return
  }
  // Group messages get their own path (attributed to the sending member).
  if (jid.endsWith('@g.us')) {
    await handleGroupMessage(instanceName, data)
    return
  }
  // Resolve a LID-addressed message to the real phone JID.
  const unresolvedLid = jid
  jid = (await resolveJid(instanceName, key)) ?? ''
  if (!jid) {
    // Don't drop it. The binding usually turns up shortly — the next
    // message we send to this chat carries it — so park the event and
    // replay it then. Our own outbound is the one thing that can't wait
    // (it's the message that would teach us), but it always resolves.
    console.error(
      '[webhook] unresolved LID, parking message for replay:',
      unresolvedLid,
      key.id,
    )
    await parkUnresolvedLidEvent(instanceName, unresolvedLid, key.id, data)
    return
  }

  // Anything that reached here resolved, so record it before doing the
  // work — a later inbound message on this chat then needs no lookup.
  learnLid(instanceName, unresolvedLid, jid)
  await replayPendingLidEvents(instanceName, unresolvedLid)

  // fromMe → either our own API send (already persisted) or a reply the
  // agent typed directly in the WhatsApp app. Capture the latter.
  if (key.fromMe) {
    await handleOutboundEcho(instanceName, data, jid)
    return
  }

  const config = await resolveConfig(instanceName)
  if (!config) {
    console.error('[webhook] no whatsapp_config for instance', instanceName)
    return
  }

  const message = adaptMessage(data)
  message.from = jidToPhone(jid)
  const contact = {
    profile: { name: data.pushName || '' },
    wa_id: jidToPhone(jid),
  }

  await processMessage(message, contact, config.account_id, config.user_id, instanceName, config.id)
}

/**
 * Resolve a message/call key's JID to a real phone JID. If it's a LID,
 * prefer the key's remoteJidAlt (present on live events) and fall back to a
 * findChats lookup. Returns null when a LID can't be resolved.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveJid(instanceName: string, key: any): Promise<string | null> {
  const jid: string = key?.remoteJid ?? ''
  if (!jid.endsWith('@lid')) return jid
  const alt = key?.remoteJidAlt
  if (typeof alt === 'string' && alt.endsWith('@s.whatsapp.net')) return alt
  return resolveLid(instanceName, jid)
}

/**
 * Handle a fromMe message. If we already persisted it (an API send), skip.
 * Otherwise it's a reply the agent typed in the WhatsApp app directly —
 * log it as an outbound (agent) message so the CRM thread stays accurate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOutboundEcho(instanceName: string, data: any, resolvedJid: string) {
  const key = data.key

  // Already have this message id? Then it's our own API send — skip.
  const { data: existing } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', key.id)
    .limit(1)
    .maybeSingle()
  if (existing) return

  const config = await resolveConfig(instanceName)
  if (!config) return

  // The recipient is remoteJid (we sent TO them), resolved to a real phone.
  const phone = normalizePhone(jidToPhone(resolvedJid))
  const contactOutcome = await findOrCreateContact(config.account_id, config.user_id, phone, '')
  if (!contactOutcome) return
  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contactOutcome.contact.id,
    config.id,
  )
  if (!convResult) return

  const message = adaptMessage(data)
  const { contentText, mediaPending } = describeMessageContent(message)
  const ALLOWED = new Set([
    'text', 'image', 'document', 'audio', 'video', 'location', 'contact', 'poll',
  ])
  const contentType = ALLOWED.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  const { data: insertedRow, error: insErr } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: convResult.conversation.id,
      sender_type: 'agent',
      content_type: contentType,
      content_text: contentText,
      media_url: null,
      media_status: mediaPending ? 'pending' : null,
      message_id: key.id,
      status: 'sent',
      created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    })
    .select('id')
    .single()
  if (insErr) {
    console.error('Error inserting outbound echo:', insErr)
    return
  }

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', convResult.conversation.id)

  if (mediaPending) {
    await backfillMessageMedia({
      rowId: insertedRow.id,
      instanceName,
      message,
    })
  }
}

// ============================================================
// Status / Stories (status@broadcast)
//
// Both contacts' statuses and our own posts arrive here as MESSAGES_UPSERT
// with remoteJid='status@broadcast'. Stored in status_updates with a 24h
// expiry; no conversation, no flows/automations. Contacts are LINKED (not
// created) so status-only posters don't pollute the CRM contact list.
// ============================================================

const STATUS_CONTENT_TYPES = new Set(['text', 'image', 'video', 'audio'])
const STATUS_TTL_MS = 24 * 60 * 60 * 1000

// The account's own linked numbers, cached in-process. Used to recognise a
// status posted by ONE of our numbers that arrives (fromMe=false) on ANOTHER
// of our numbers — it's still OUR status, not a contact's. whatsapp_config
// doesn't store the owner phone, so we resolve it from Evolution once per TTL.
const ownPhonesCache = new Map<string, { phones: Set<string>; at: number }>()
const OWN_PHONES_TTL_MS = 60 * 60 * 1000

async function getAccountOwnPhones(accountId: string): Promise<Set<string>> {
  const cached = ownPhonesCache.get(accountId)
  if (cached && Date.now() - cached.at < OWN_PHONES_TTL_MS) return cached.phones

  const phones = new Set<string>()
  const { data: rows } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('instance_name')
    .eq('account_id', accountId)
    .not('instance_name', 'is', null)
  for (const r of rows ?? []) {
    try {
      const info = await fetchInstance(r.instance_name)
      const phone = info?.ownerJid ? normalizePhone(jidToPhone(info.ownerJid)) : ''
      if (phone) phones.add(phone)
    } catch {
      /* skip an instance we can't reach; best-effort */
    }
  }
  ownPhonesCache.set(accountId, { phones, at: Date.now() })
  return phones
}

/** Baileys backgroundArgb (signed 32-bit ARGB int) → #RRGGBB, or null. */
function argbToHex(argb: unknown): string | null {
  if (typeof argb !== 'number' || !Number.isFinite(argb)) return null
  const rgb = (argb >>> 0) & 0x00ffffff
  return `#${rgb.toString(16).padStart(6, '0')}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleStatusBroadcast(instanceName: string, data: any) {
  const key = data?.key
  if (!key?.id) return

  const config = await resolveConfig(instanceName)
  if (!config) return

  const message = adaptMessage(data)
  if (!STATUS_CONTENT_TYPES.has(message.type)) return // skip reactions, etc.

  let isMine = key.fromMe === true

  // Resolve the poster (for contacts' statuses) to a real phone JID.
  let posterPhone: string | null = null
  let contactId: string | null = null
  let posterName: string | null = null
  if (!isMine) {
    const posterJid =
      (await resolveJid(instanceName, {
        remoteJid: key.participant || key.participantAlt || '',
        remoteJidAlt: key.participantAlt,
      })) || ''
    if (!posterJid) return
    posterPhone = normalizePhone(jidToPhone(posterJid))

    // A status posted by one of the account's OWN numbers, received on
    // another of our numbers (Baileys has emitOwnEvents=false, so the
    // posting number sends no fromMe echo), is still OUR status — not a
    // contact's. Reclassify as mine.
    const ownPhones = await getAccountOwnPhones(config.account_id)
    if (posterPhone && ownPhones.has(posterPhone)) {
      isMine = true
      posterPhone = null
    } else {
      posterName = data.pushName || posterPhone || null
      // Link an existing contact if we know them; do NOT create one.
      const existing = await findExistingContact(supabaseAdmin(), config.account_id, posterPhone)
      contactId = existing?.id ?? null
    }
  }

  // Media (image/video/audio) → chat-media bucket.
  let mediaUrl: string | null = null
  let contentText: string | null = null
  let backgroundColor: string | null = null

  if (message.type === 'text') {
    contentText = message.text?.body || null
    backgroundColor = argbToHex(data.message?.extendedTextMessage?.backgroundArgb)
  } else {
    // Statuses are images/videos/audio only — always rendered inline, so
    // no attachment naming here.
    const mimeHint =
      message.image?.mime_type || message.video?.mime_type || message.audio?.mime_type
    const { url } = await storeInboundMedia(instanceName, message._raw, message.id, {
      fallbackMime: mimeHint,
    })
    mediaUrl = url
    contentText = message.image?.caption || message.video?.caption || null
  }

  const postedAt = new Date(parseInt(message.timestamp) * 1000)
  const expiresAt = new Date(postedAt.getTime() + STATUS_TTL_MS)

  const { error } = await supabaseAdmin()
    .from('status_updates')
    .upsert(
      {
        account_id: config.account_id,
        whatsapp_config_id: config.id,
        contact_id: contactId,
        is_mine: isMine,
        poster_phone: posterPhone,
        poster_name: posterName,
        content_type: message.type,
        content_text: contentText,
        media_url: mediaUrl,
        background_color: backgroundColor,
        message_id: key.id,
        posted_at: postedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'account_id,message_id', ignoreDuplicates: true },
    )
  if (error) console.error('[webhook] status insert failed:', error.message)
}

// ============================================================
// Status revokes (messages.update with status DELETED)
//
// When a poster deletes their status, WhatsApp removes it from every
// viewer — mirror that by dropping the status (and its recorded viewers)
// from our feed. Also fires when OUR own status is deleted from the
// phone, keeping "My status" in sync.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleStatusRevoke(instanceName: string, upd: any) {
  const messageId: string | undefined = upd?.keyId || upd?.key?.id
  if (!messageId) return
  const config = await resolveConfig(instanceName)
  if (!config) return

  const db = supabaseAdmin()
  const { data: status } = await db
    .from('status_updates')
    .select('id')
    .eq('account_id', config.account_id)
    .eq('message_id', messageId)
    .maybeSingle()
  if (!status) return

  await db
    .from('status_views')
    .delete()
    .eq('account_id', config.account_id)
    .eq('message_id', messageId)
  await db.from('status_updates').delete().eq('id', status.id)
}

// ============================================================
// Status view receipts (message-receipt.update)
//
// "Seen by" for our own statuses. Needs the patched Evolution image,
// which forwards message-receipt.update with the viewer's jid. Each
// receipt on a status@broadcast message our account posted becomes a
// status_views row.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleReceiptUpdate(instanceName: string, updates: any[]) {
  const statusReceipts = updates.filter(
    (u) => u?.key?.remoteJid === 'status@broadcast' && u?.receipt?.userJid,
  )
  if (statusReceipts.length === 0) return

  const config = await resolveConfig(instanceName)
  if (!config) return

  for (const u of statusReceipts) {
    const messageId: string | undefined = u.key?.id
    if (!messageId) continue

    // Only track views for OUR own posted statuses.
    const { data: status } = await supabaseAdmin()
      .from('status_updates')
      .select('id')
      .eq('account_id', config.account_id)
      .eq('message_id', messageId)
      .eq('is_mine', true)
      .maybeSingle()
    if (!status) continue

    const rawViewerJid: string = u.receipt.userJid
    const viewerJid =
      (await resolveJid(instanceName, {
        remoteJid: rawViewerJid,
        remoteJidAlt: u.receipt.userJidAlt,
      })) || rawViewerJid
    const viewerPhone = normalizePhone(jidToPhone(viewerJid))
    if (!viewerPhone) continue

    const existing = await findExistingContact(supabaseAdmin(), config.account_id, viewerPhone)
    // Enrich unresolved (LID) viewers from Evolution's contact store — the
    // WhatsApp profile pic (usually present) + pushName (often null) make the
    // "seen by" list recognizable even when they aren't a CRM contact.
    const evo = existing ? null : await findContactByJid(instanceName, rawViewerJid)
    const viewedTs =
      u.receipt.readTimestamp || u.receipt.playedTimestamp || u.receipt.receiptTimestamp
    const viewedAt =
      typeof viewedTs === 'number'
        ? new Date(viewedTs * 1000).toISOString()
        : new Date().toISOString()

    const { error } = await supabaseAdmin()
      .from('status_views')
      .upsert(
        {
          account_id: config.account_id,
          status_update_id: status.id,
          message_id: messageId,
          viewer_contact_id: existing?.id ?? null,
          viewer_phone: viewerPhone,
          viewer_name: existing?.name ?? evo?.pushName ?? null,
          viewer_avatar_url: evo?.profilePicUrl ?? null,
          viewer_jid: rawViewerJid,
          viewed_at: viewedAt,
        },
        { onConflict: 'account_id,message_id,viewer_phone', ignoreDuplicates: true },
      )
    if (error) console.error('[webhook] status view insert failed:', error.message)
  }
}

/**
 * Instance → owning account. Memoised (see `resolveInstanceConfig`): this
 * runs on every inbound event, and an uncached SELECT here sat in front of
 * every message write.
 */
async function resolveConfig(instanceName: string): Promise<InstanceConfig | null> {
  return resolveInstanceConfig(instanceName, async (name) => {
    const { data, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, account_id, user_id')
      .eq('instance_name', name)
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return data
  })
}

/** Convert a Baileys message object into the internal WhatsAppMessage. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptMessage(data: any): WhatsAppMessage {
  const key = data.key
  // "View once" media (disappearing photos/videos) arrives wrapped in a
  // viewOnceMessage[V2] envelope — unwrap it so the inner image/video is
  // detected like any other. (Media download unwraps it on Evolution's
  // side too, so `_raw` stays the original wrapped message.)
  const outer = data.message ?? {}
  const m =
    outer.viewOnceMessageV2?.message ??
    outer.viewOnceMessage?.message ??
    outer.viewOnceMessageV2Extension?.message ??
    outer
  const base: WhatsAppMessage = {
    id: key.id,
    from: jidToPhone(key.remoteJid),
    timestamp: String(data.messageTimestamp ?? Math.floor(Date.now() / 1000)),
    type: 'text',
    _raw: data,
  }

  // Quoted / swipe-reply context (present on several message variants).
  const ctxId =
    m.extendedTextMessage?.contextInfo?.stanzaId ||
    m.imageMessage?.contextInfo?.stanzaId ||
    m.videoMessage?.contextInfo?.stanzaId ||
    m.documentMessage?.contextInfo?.stanzaId ||
    m.audioMessage?.contextInfo?.stanzaId
  if (ctxId) base.context = { id: ctxId }

  if (typeof m.conversation === 'string') {
    return { ...base, type: 'text', text: { body: m.conversation } }
  }
  if (m.extendedTextMessage?.text != null) {
    return { ...base, type: 'text', text: { body: m.extendedTextMessage.text } }
  }
  if (m.imageMessage) {
    return {
      ...base,
      type: 'image',
      image: { mime_type: m.imageMessage.mimetype, caption: m.imageMessage.caption },
    }
  }
  if (m.videoMessage) {
    return {
      ...base,
      type: 'video',
      video: { mime_type: m.videoMessage.mimetype, caption: m.videoMessage.caption },
    }
  }
  // A PTV (round "video note") arrives as its own field. Treat it as a
  // video — same download + render path; the sender's client drew it round.
  if (m.ptvMessage) {
    return {
      ...base,
      type: 'video',
      video: { mime_type: m.ptvMessage.mimetype, caption: m.ptvMessage.caption },
    }
  }
  if (m.audioMessage) {
    return { ...base, type: 'audio', audio: { mime_type: m.audioMessage.mimetype } }
  }
  if (m.documentMessage) {
    return {
      ...base,
      type: 'document',
      document: {
        mime_type: m.documentMessage.mimetype,
        filename: m.documentMessage.fileName,
        caption: m.documentMessage.caption,
      },
    }
  }
  // Document sent with a caption arrives as documentWithCaptionMessage.
  if (m.documentWithCaptionMessage?.message?.documentMessage) {
    const doc = m.documentWithCaptionMessage.message.documentMessage
    return {
      ...base,
      type: 'document',
      document: { mime_type: doc.mimetype, filename: doc.fileName, caption: doc.caption },
    }
  }
  if (m.stickerMessage) {
    return { ...base, type: 'sticker', sticker: { mime_type: m.stickerMessage.mimetype } }
  }
  if (m.locationMessage) {
    return {
      ...base,
      type: 'location',
      location: {
        latitude: m.locationMessage.degreesLatitude,
        longitude: m.locationMessage.degreesLongitude,
        name: m.locationMessage.name,
        address: m.locationMessage.address,
      },
    }
  }
  if (m.eventMessage) {
    const ev = m.eventMessage
    return {
      ...base,
      type: 'event',
      event: {
        name: ev.name,
        description: ev.description,
        startTime: typeof ev.startTime === 'number' ? ev.startTime : Number(ev.startTime) || undefined,
        endTime: typeof ev.endTime === 'number' ? ev.endTime : Number(ev.endTime) || undefined,
        location: ev.location
          ? { name: ev.location.name, address: ev.location.address }
          : undefined,
      },
    }
  }
  if (m.reactionMessage) {
    return {
      ...base,
      type: 'reaction',
      reaction: { message_id: m.reactionMessage.key?.id, emoji: m.reactionMessage.text },
    }
  }
  if (m.buttonsResponseMessage) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: m.buttonsResponseMessage.selectedButtonId,
          title: m.buttonsResponseMessage.selectedDisplayText,
        },
      },
    }
  }
  if (m.templateButtonReplyMessage) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: m.templateButtonReplyMessage.selectedId,
          title: m.templateButtonReplyMessage.selectedDisplayText,
        },
      },
    }
  }
  if (m.listResponseMessage) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: {
          id: m.listResponseMessage.singleSelectReply?.selectedRowId,
          title: m.listResponseMessage.title,
        },
      },
    }
  }

  // Unknown / unsupported message variant → empty text (never dropped).
  return { ...base, type: 'text', text: { body: '' } }
}

// ============================================================
// Delivery / read acks (messages.update)
// ============================================================

/** Baileys ack status (string or numeric) → our messages.status value. */
function mapAck(status: unknown): string | null {
  switch (String(status).toUpperCase()) {
    case 'SERVER_ACK':
    case '2':
      return 'sent'
    case 'DELIVERY_ACK':
    case '3':
      return 'delivered'
    case 'READ':
    case '4':
    case 'PLAYED':
    case '5':
      return 'read'
    case 'ERROR':
    case '0':
      return 'failed'
    default:
      return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleAck(upd: any) {
  const messageId: string | undefined =
    upd?.keyId || upd?.key?.id || upd?.messageId
  const rawStatus = upd?.status ?? upd?.update?.status
  if (!messageId) return
  const status = mapAck(rawStatus)
  if (!status) return
  await handleStatusUpdate({
    id: messageId,
    status,
    timestamp: String(Math.floor(Date.now() / 1000)),
  })
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient. `failed` is a
// terminal side branch valid only from pending / sent.
const RECIPIENT_STATUS_LADDER = ['pending', 'sent', 'delivered', 'read', 'replied'] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') return current === 'pending' || current === 'sent'
  if (current === 'failed') return false
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
}) {
  // 1) Mirror onto messages. message_id is NOT unique (Baileys ids can
  //    repeat across instances), so this updates 0..N rows.
  const { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update({ status: status.status })
    .eq('message_id', status.id)
  if (msgErr) console.error('Error updating message status:', msgErr)

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id. The
  //    aggregate trigger re-derives the parent broadcast's counts.
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()
  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle()

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
  } else if (recipient && isValidStatusTransition(recipient.status, status.status)) {
    const update: Record<string, unknown> = { status: status.status }
    if (status.status === 'sent') update.sent_at = tsIso
    if (status.status === 'delivered') update.delivered_at = tsIso
    if (status.status === 'read') update.read_at = tsIso
    const { error: recUpdateErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id)
    if (recUpdateErr) console.error('Error updating broadcast recipient status:', recUpdateErr)
  }

  // 3) Public-webhook fan-out. Bounded to one row purely to resolve the
  //    owning account for delivery.
  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', status.id)
    .limit(1)
    .maybeSingle()

  if (msgRow) {
    const conv = msgRow.conversations as { account_id: string } | null
    const accountId = conv?.account_id
    if (accountId) {
      await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.status_updated', {
        whatsapp_message_id: status.id,
        conversation_id: msgRow.conversation_id,
        status: status.status,
      })
    }
  }
}

// ============================================================
// Connection state
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleConnectionUpdate(instanceName: string, data: any) {
  const state: string | undefined = data?.state
  if (!state) return
  const status = state === 'open' ? 'connected' : 'disconnected'
  const patch: Record<string, unknown> = {
    connection_state: state,
    status,
    updated_at: new Date().toISOString(),
  }
  if (state === 'open') patch.connected_at = new Date().toISOString()
  const { error } = await supabaseAdmin()
    .from('whatsapp_config')
    .update(patch)
    .eq('instance_name', instanceName)
  if (error) console.error('[webhook] connection_state update failed:', error.message)
}

// ============================================================
// Broadcast reply flagging
// ============================================================

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return
    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)
    if (updErr) console.error('Error marking broadcast recipient replied:', updErr)
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

/** Resolve a WhatsApp message id into the internal UUID, scoped to one conversation. */
async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string,
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(reaction.message_id, conversationId)
  if (!targetInternalId) {
    console.warn('[webhook] reaction target message not found; skipping', reaction.message_id)
    return
  }

  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (delError) console.error('[webhook] reaction delete failed:', delError.message)
    return
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' },
    )
  if (upsertError) console.error('[webhook] reaction upsert failed:', upsertError.message)
}

// ============================================================
// Core inbound-message processing (transport-neutral)
// ============================================================

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  accountId: string,
  configOwnerUserId: string,
  instanceName: string,
  whatsappConfigId?: string,
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName,
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // The contact just messaged us → they are definitely on WhatsApp.
  // Awaited (not a floating promise) because we're inside after(): a
  // detached promise can be frozen before it writes. Idempotent.
  if (contactRecord.is_on_whatsapp !== true) {
    const { error: waErr } = await supabaseAdmin()
      .from('contacts')
      .update({ is_on_whatsapp: true, whatsapp_checked_at: new Date().toISOString() })
      .eq('id', contactRecord.id)
    if (waErr) console.error('[webhook] is_on_whatsapp update failed:', waErr.message)
  }

  // On first contact, pull their avatar + enrich with WhatsApp profile
  // (about text, business profile). Best-effort, awaited (after() safety).
  if (!contactRecord.avatar_url) {
    await syncContactAvatar(supabaseAdmin(), instanceName, contactRecord.id, senderPhone)
  }
  if (contactOutcome.wasCreated) {
    await syncContactProfile(supabaseAdmin(), instanceName, contactRecord.id, senderPhone)
  }

  const convResult = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id,
    whatsappConfigId,
  )
  if (!convResult) {
    if (contactOutcome.pendingWrites) await contactOutcome.pendingWrites
    return
  }
  const conversation = convResult.conversation

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  // Reactions short-circuit — they aren't messages.
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    if (contactOutcome.pendingWrites) await contactOutcome.pendingWrites
    return
  }

  const { contentText, mediaPending, interactiveReplyId } = describeMessageContent(message)

  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(message.context.id, conversation.id)
    if (!replyToInternalId) {
      console.warn('[webhook] reply context parent not found:', message.context.id)
    }
  }

  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive', 'event',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  // "Has this contact ever written before?" — an existence check, not a
  // count. The old `count: 'exact'` rescanned the whole thread on every
  // inbound and grew with it, to decide a single boolean.
  //
  // Excluding *this* message's own id makes the answer identical whether
  // the query reaches the DB before or after the INSERT below — which is
  // what lets the two run concurrently and takes a full round trip off the
  // critical path. (The IS NULL arm keeps rows whose message_id is null;
  // a bare `neq` evaluates to NULL for those and would silently drop them,
  // making a returning contact look brand new.)
  const priorInboundQuery = supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .or(`message_id.is.null,message_id.neq."${message.id}"`)
    .limit(1)

  // Insert first, fetch media after. `.select('id')` costs no extra round
  // trip and gives the backfill an unambiguous row to target.
  const insertQuery = supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: null,
      media_status: mediaPending ? 'pending' : null,
      message_id: message.id,
      status: 'delivered',
      created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
      reply_to_message_id: replyToInternalId,
      interactive_reply_id: interactiveReplyId,
    })
    .select('id')
    .single()

  const [priorInbound, { data: insertedRow, error: msgError }] = await Promise.all([
    priorInboundQuery,
    insertQuery,
  ])

  if (msgError) {
    console.error('Error inserting message:', msgError)
    if (contactOutcome.pendingWrites) await contactOutcome.pendingWrites
    return
  }

  if (priorInbound.error) {
    console.error('[webhook] prior-inbound check failed:', priorInbound.error.message)
  }
  // On error, fall back to "not the first" — re-running a first-contact
  // flow for an existing conversation is the worse of the two mistakes.
  const isFirstInboundMessage =
    !priorInbound.error && (priorInbound.data?.length ?? 0) === 0

  // Kick the media fetch off now so it overlaps the conversation update,
  // flows and automations below — none of which read media_url. It is
  // awaited before this function returns (see the end of processMessage),
  // so `after()` still keeps the process alive until it lands. The catch
  // is attached here, at creation, so a rejection can never surface as an
  // unhandled rejection during the awaits in between.
  const mediaBackfill = mediaPending
    ? backfillMessageMedia({
        rowId: insertedRow.id,
        instanceName,
        message,
      }).catch((err) =>
        console.error('[webhook] media backfill failed:', err instanceof Error ? err.message : err),
      )
    : null

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
  if (convError) console.error('Error updating conversation:', convError)

  await flagBroadcastReplyIfAny(accountId, contactRecord.id)

  // Flow runner dispatch. If the runner consumes the message we suppress
  // the content-level automation triggers for this inbound.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: interactiveReplyId,
          reply_title: contentText ?? '',
          meta_message_id: message.id,
        }
      : {
          kind: 'text',
          text: contentText ?? message.text?.body ?? '',
          meta_message_id: message.id,
        },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const inboundText = contentText ?? message.text?.body ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  // AI auto-reply — plain-text inbound the flow runner did not consume.
  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    })
  }

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: message.id,
    content_type: contentType,
    text: contentText,
  })

  // Settle the writes we started but didn't block on — the media fetch
  // from just after the INSERT, and any pushName rename from before it.
  // Both have had the whole flow/automation stage to run in, so these are
  // usually already resolved.
  if (mediaBackfill) await mediaBackfill
  if (contactOutcome.pendingWrites) await contactOutcome.pendingWrites
}

// ============================================================
// Media + content parsing
// ============================================================


/**
 * Download an inbound media message via Evolution and store it in the
 * public `chat-media` Supabase bucket, returning its public URL (or null).
 */
async function storeInboundMedia(
  instanceName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawMessage: any,
  messageId: string,
  opts: {
    fallbackMime?: string
    /** Sender's filename, when WhatsApp provided one (documents). */
    fallbackName?: string
    /** Serve with the original filename attached — documents only. */
    asAttachment?: boolean
  } = {},
): Promise<{ url: string | null; mime: string | null }> {
  const { fallbackMime, fallbackName, asAttachment } = opts
  try {
    const media = await getBase64FromMediaMessage({ instanceName, message: rawMessage })
    if (!media?.base64) return { url: null, mime: fallbackMime ?? null }
    const mime = media.mimetype || fallbackMime || 'application/octet-stream'
    const fileName = media.fileName || fallbackName
    const buffer = Buffer.from(media.base64, 'base64')
    const ext = storageExtension(fileName, mime)
    const path = `inbound/${messageId}${ext}`
    // Upload with the mime stripped of its parameters. The bucket matches
    // Content-Type against its allowed_mime_types list as an exact string,
    // so `audio/ogg; codecs=opus` — what WhatsApp sends for every voice
    // note — was rejected outright even though `audio/ogg` is allowed.
    // Chromium sniffs the codec from the container, so nothing is lost.
    const uploadMime = baseMime(mime) ?? 'application/octet-stream'
    const { error } = await supabaseAdmin()
      .storage.from('chat-media')
      .upload(path, buffer, { contentType: uploadMime, upsert: true })
    if (error) {
      console.error('[webhook] media upload failed:', error.message)
      return { url: null, mime }
    }
    // Documents are clicked to download, so hand back the sender's own
    // filename rather than the message id. Images/video/audio render
    // inline and deliberately get a plain URL.
    const { data } = supabaseAdmin()
      .storage.from('chat-media')
      .getPublicUrl(path, asAttachment && fileName ? { download: fileName } : undefined)
    return { url: data.publicUrl, mime }
  } catch (err) {
    console.error(
      '[webhook] media download failed:',
      err instanceof Error ? err.message : err,
    )
    return { url: null, mime: fallbackMime ?? null }
  }
}

/**
 * Backfill a message row's media after it has already been inserted.
 *
 * The download from Evolution plus the storage upload is the slowest part
 * of inbound processing — a video can take tens of seconds — so it must
 * never sit in front of the INSERT. The row goes in with
 * `media_status: 'pending'`, this runs afterwards, and the resulting
 * UPDATE reaches the open thread over Realtime.
 *
 * Awaited by callers (never detached): we're inside `after()`, and a
 * floating promise can be frozen before it writes.
 */
async function backfillMessageMedia(args: {
  rowId: string
  instanceName: string
  message: WhatsAppMessage
}): Promise<void> {
  const { rowId, instanceName, message } = args
  const { url } = await storeInboundMedia(instanceName, message._raw, message.id, {
    fallbackMime: fallbackMimeFor(message),
    fallbackName: message.document?.filename,
    asAttachment: message.type === 'document',
  })
  const { error } = await supabaseAdmin()
    .from('messages')
    .update({
      media_url: url,
      media_status: url ? 'ready' : 'failed',
    })
    .eq('id', rowId)
  if (error) console.error('[webhook] media backfill update failed:', error.message)
}

/** The mime WhatsApp advertised for a media message, used as a fallback. */
function fallbackMimeFor(message: WhatsAppMessage): string | undefined {
  switch (message.type) {
    case 'image':
      return message.image?.mime_type
    case 'video':
      return message.video?.mime_type
    case 'document':
      return message.document?.mime_type
    case 'audio':
      return message.audio?.mime_type
    case 'sticker':
      return message.sticker?.mime_type
    default:
      return undefined
  }
}

/**
 * Everything about a message that can be known without a network call —
 * the caption/body, whether media needs fetching, and any interactive
 * reply id. Deliberately synchronous so the INSERT never waits on media.
 */
function describeMessageContent(message: WhatsAppMessage): {
  contentText: string | null
  mediaPending: boolean
  interactiveReplyId: string | null
} {
  const empty = {
    contentText: null,
    mediaPending: false,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      return { ...empty, contentText: message.image?.caption || null, mediaPending: true }
    case 'video':
      return { ...empty, contentText: message.video?.caption || null, mediaPending: true }
    case 'document':
      return {
        ...empty,
        contentText: message.document?.caption || message.document?.filename || null,
        mediaPending: true,
      }
    case 'audio':
      return { ...empty, mediaPending: true }
    case 'sticker':
      return { ...empty, mediaPending: true }

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'event':
      if (message.event?.name && typeof message.event.startTime === 'number') {
        return {
          ...empty,
          contentText: formatEventSummary({
            name: message.event.name,
            description: message.event.description,
            startTime: message.event.startTime,
            endTime: message.event.endTime,
            location: message.event.location,
          }),
        }
      }
      return { ...empty, contentText: message.event?.name || '[Event]' }

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return { ...empty, contentText: reply.title || reply.id, interactiveReplyId: reply.id }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    default:
      return { ...empty, contentText: `[Unsupported message type: ${message.type}]` }
  }
}

// ============================================================
// Labels ↔ tags (WhatsApp → CRM)
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleLabelAssociation(instanceName: string, data: any) {
  const labelId = String(data?.labelId ?? data?.association?.labelId ?? '')
  const chatId: string = data?.chatId ?? data?.association?.chatId ?? data?.remoteJid ?? ''
  const action: string = data?.type ?? data?.action ?? 'add'
  if (!labelId || !chatId) return

  const config = await resolveConfig(instanceName)
  if (!config) return

  const { data: tag } = await supabaseAdmin()
    .from('tags')
    .select('id')
    .eq('account_id', config.account_id)
    .eq('whatsapp_label_id', labelId)
    .maybeSingle()
  if (!tag) return // this label isn't linked to a CRM tag yet (run Sync labels)

  const contact = await findExistingContact(
    supabaseAdmin(),
    config.account_id,
    normalizePhone(jidToPhone(chatId)),
  )
  if (!contact) return

  if (action === 'remove') {
    await supabaseAdmin()
      .from('contact_tags')
      .delete()
      .eq('contact_id', contact.id)
      .eq('tag_id', tag.id)
  } else {
    const { data: exists } = await supabaseAdmin()
      .from('contact_tags')
      .select('contact_id')
      .eq('contact_id', contact.id)
      .eq('tag_id', tag.id)
      .maybeSingle()
    if (!exists) {
      await supabaseAdmin()
        .from('contact_tags')
        .insert({ contact_id: contact.id, tag_id: tag.id })
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleLabelEdit(instanceName: string, data: any) {
  const labelId = String(data?.labelId ?? data?.id ?? '')
  const name: string | undefined = data?.name
  if (!labelId || !name) return

  const config = await resolveConfig(instanceName)
  if (!config) return

  const { data: tag } = await supabaseAdmin()
    .from('tags')
    .select('id, name')
    .eq('account_id', config.account_id)
    .eq('whatsapp_label_id', labelId)
    .maybeSingle()

  if (tag) {
    if (tag.name !== name) {
      await supabaseAdmin().from('tags').update({ name }).eq('id', tag.id)
    }
  } else {
    await supabaseAdmin().from('tags').insert({
      account_id: config.account_id,
      user_id: config.user_id,
      name,
      color: '#64748b',
      whatsapp_label_id: labelId,
    })
  }
}

// ============================================================
// Contact / conversation find-or-create
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  wasCreated: boolean
  /**
   * A started-but-not-awaited write (currently just the pushName rename).
   *
   * Nothing downstream reads it — `contact` deliberately carries the row
   * as it was read, which is what the awaited version returned too — so
   * blocking the message insert on it bought nothing. Callers must still
   * settle it before they return: we run inside `after()`, where a truly
   * detached promise can be frozen before it writes.
   *
   * null when there was nothing to write.
   */
  pendingWrites: Promise<void> | null
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
  isGroup = false,
): Promise<ContactOutcome | null> {
  // Evolution delivers each inbound message as its own webhook POST, so a
  // burst from a brand-new number runs this concurrently N times. The DB
  // UNIQUE(account_id, phone_normalized) index lets exactly one insert win;
  // every loser MUST resolve to that winner, never drop its message.
  //
  // A single find→insert→re-select-once was lossy under load: a concurrent
  // insert can fail with a non-23505 error (deadlock / serialization /
  // transient pooler hiccup during the burst), or the one-shot re-select
  // can miss, and either fell straight through to `return null` — dropping
  // the message. Retrying find→insert re-resolves the winner on the next
  // pass instead (the await between passes gives the winner time to commit).
  const MAX_ATTEMPTS = 4
  let lastError: unknown = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existingContact = await findExistingContact(supabaseAdmin(), accountId, phone)
    if (existingContact) {
      // WhatsApp sends pushName on every message, so this fires whenever a
      // contact's display name drifts from ours. Started here, settled by
      // the caller — see ContactOutcome.pendingWrites.
      const pendingWrites =
        name && name !== existingContact.name
          ? Promise.resolve(
              supabaseAdmin()
                .from('contacts')
                .update({ name, updated_at: new Date().toISOString() })
                .eq('id', existingContact.id),
            )
              .then(({ error }) => {
                if (error) console.error('[webhook] contact rename failed:', error.message)
              })
              .catch((err) =>
                console.error(
                  '[webhook] contact rename failed:',
                  err instanceof Error ? err.message : err,
                ),
              )
          : null
      return { contact: existingContact, wasCreated: false, pendingWrites }
    }

    const { data: newContact, error: createError } = await supabaseAdmin()
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        phone,
        name: name || phone,
        is_group: isGroup,
      })
      .select()
      .single()

    if (!createError) return { contact: newContact, wasCreated: true, pendingWrites: null }

    // Insert failed — a lost race (unique violation) or a transient error.
    // Loop back to re-resolve the winner. A genuinely permanent error just
    // re-fails until attempts run out, then returns null (as before).
    lastError = createError
  }

  // Exhausted retries — one final resolve for a winner that has since
  // committed, else give up and log.
  const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
  if (raced) return { contact: raced, wasCreated: false, pendingWrites: null }
  console.error('Error creating contact (retries exhausted):', lastError)
  return null
}

// Find the account's (single) conversation for a contact. `.order().limit(1)
// .maybeSingle()` — NOT `.single()`, which ERRORS on 2+ rows and drove the
// runaway-duplication bug. Collapses onto the OLDEST row so it recovers even
// if duplicates somehow exist. The DB UNIQUE(account_id, contact_id) index
// (migration 037) is the authoritative guard.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findConversation(accountId: string, contactId: string): Promise<any | null> {
  const { data } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// Keep the conversation tagged with the number it's currently on, so replies
// go out from the same line the customer reached.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function retagConversationNumber(conv: any, whatsappConfigId?: string) {
  if (whatsappConfigId && conv.whatsapp_config_id !== whatsappConfigId) {
    await supabaseAdmin()
      .from('conversations')
      .update({ whatsapp_config_id: whatsappConfigId })
      .eq('id', conv.id)
    conv.whatsapp_config_id = whatsappConfigId
  }
  return conv
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  whatsappConfigId?: string,
) {
  // Same burst-concurrency hazard as findOrCreateContact: Evolution delivers
  // each message as its own POST, so a brand-new contact's first burst runs
  // this concurrently N times. The DB unique index lets one insert win; every
  // loser must resolve to that winner, never drop its message. A single
  // find→insert→re-select-once was lossy (a losing insert can fail with a
  // non-23505 error, or the one-shot re-select can miss → return null →
  // dropped message). Retry find→insert so losers re-resolve on the next pass.
  const MAX_ATTEMPTS = 4
  let lastError: unknown = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = await findConversation(accountId, contactId)
    if (existing) {
      return { conversation: await retagConversationNumber(existing, whatsappConfigId), created: false }
    }

    const { data: newConv, error: createError } = await supabaseAdmin()
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        contact_id: contactId,
        whatsapp_config_id: whatsappConfigId ?? null,
      })
      .select()
      .single()

    if (!createError) return { conversation: newConv, created: true }
    lastError = createError
  }

  const raced = await findConversation(accountId, contactId)
  if (raced) {
    return { conversation: await retagConversationNumber(raced, whatsappConfigId), created: false }
  }
  console.error('Error creating conversation (retries exhausted):', lastError)
  return null
}
