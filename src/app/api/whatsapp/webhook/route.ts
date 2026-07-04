import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getBase64FromMediaMessage,
  jidToPhone,
  resolveLid,
  fetchGroupInfo,
} from '@/lib/whatsapp/provider/evolution'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { syncContactAvatar, syncContactProfile } from '@/lib/whatsapp/avatar'

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
        await handleAck(upd)
      }
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

    // qrcode.updated, contacts.upsert, send.message (our own echoes),
    // presence.update, etc. — intentionally ignored here.
    default:
      break
  }
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

  const groupContact = await findOrCreateContact(
    config.account_id,
    config.user_id,
    groupId,
    groupId,
    true,
  )
  if (!groupContact) return

  // Enrich the group's name from WhatsApp the first time we see it.
  if (groupContact.wasCreated) {
    const info = await fetchGroupInfo(instanceName, groupJid)
    if (info?.subject) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name: info.subject, updated_at: new Date().toISOString() })
        .eq('id', groupContact.contact.id)
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
  const { contentText, mediaUrl } = await parseMessageContent(message, instanceName)
  const contentType = GROUP_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  const { error: insErr } = await supabaseAdmin().from('messages').insert({
    conversation_id: convResult.conversation.id,
    sender_type: key.fromMe ? 'agent' : 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: key.id,
    author_name: authorName,
    author_phone: authorPhone,
    status: key.fromMe ? 'sent' : 'delivered',
    created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
  })
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
// Inbound messages
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInboundMessage(instanceName: string, data: any) {
  const key = data?.key
  if (!key?.id || !key.remoteJid) return

  let jid: string = key.remoteJid
  if (jid === 'status@broadcast' || jid.endsWith('@newsletter')) {
    return
  }
  // Group messages get their own path (attributed to the sending member).
  if (jid.endsWith('@g.us')) {
    await handleGroupMessage(instanceName, data)
    return
  }
  // Resolve a LID-addressed message to the real phone JID.
  jid = (await resolveJid(instanceName, key)) ?? ''
  if (!jid) return

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
  const { contentText, mediaUrl } = await parseMessageContent(message, instanceName)
  const ALLOWED = new Set([
    'text', 'image', 'document', 'audio', 'video', 'location', 'contact', 'poll',
  ])
  const contentType = ALLOWED.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  await supabaseAdmin().from('messages').insert({
    conversation_id: convResult.conversation.id,
    sender_type: 'agent',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: key.id,
    status: 'sent',
    created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
  })
  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', convResult.conversation.id)
}

async function resolveConfig(
  instanceName: string,
): Promise<{ id: string; account_id: string; user_id: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, user_id')
    .eq('instance_name', instanceName)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data
}

/** Convert a Baileys message object into the internal WhatsAppMessage. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptMessage(data: any): WhatsAppMessage {
  const key = data.key
  const m = data.message ?? {}
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
  if (!convResult) return
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
    return
  }

  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, instanceName)
  void mediaType

  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(message.context.id, conversation.id)
    if (!replyToInternalId) {
      console.warn('[webhook] reply context parent not found:', message.context.id)
    }
  }

  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: message.id,
    status: 'delivered',
    created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: interactiveReplyId,
  })

  if (msgError) {
    console.error('Error inserting message:', msgError)
    return
  }

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
}

// ============================================================
// Media + content parsing
// ============================================================

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
}

/**
 * Download an inbound media message via Evolution and store it in the
 * public `chat-media` Supabase bucket, returning its public URL (or null).
 */
async function storeInboundMedia(
  instanceName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawMessage: any,
  messageId: string,
  fallbackMime?: string,
): Promise<{ url: string | null; mime: string | null }> {
  try {
    const media = await getBase64FromMediaMessage({ instanceName, message: rawMessage })
    if (!media?.base64) return { url: null, mime: fallbackMime ?? null }
    const mime = media.mimetype || fallbackMime || 'application/octet-stream'
    const buffer = Buffer.from(media.base64, 'base64')
    const ext = MIME_EXT[mime] ?? ''
    const path = `inbound/${messageId}${ext}`
    const { error } = await supabaseAdmin()
      .storage.from('chat-media')
      .upload(path, buffer, { contentType: mime, upsert: true })
    if (error) {
      console.error('[webhook] media upload failed:', error.message)
      return { url: null, mime }
    }
    const { data } = supabaseAdmin().storage.from('chat-media').getPublicUrl(path)
    return { url: data.publicUrl, mime }
  } catch (err) {
    console.error(
      '[webhook] media download failed:',
      err instanceof Error ? err.message : err,
    )
    return { url: null, mime: fallbackMime ?? null }
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  instanceName: string,
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  interactiveReplyId: string | null
}> {
  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  const store = (mime?: string) => storeInboundMedia(instanceName, message._raw, message.id, mime)

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image': {
      const { url, mime } = await store(message.image?.mime_type)
      return { ...empty, contentText: message.image?.caption || null, mediaUrl: url, mediaType: mime }
    }
    case 'video': {
      const { url, mime } = await store(message.video?.mime_type)
      return { ...empty, contentText: message.video?.caption || null, mediaUrl: url, mediaType: mime }
    }
    case 'document': {
      const { url, mime } = await store(message.document?.mime_type)
      return {
        ...empty,
        contentText: message.document?.caption || message.document?.filename || null,
        mediaUrl: url,
        mediaType: mime,
      }
    }
    case 'audio': {
      const { url, mime } = await store(message.audio?.mime_type)
      return { ...empty, mediaUrl: url, mediaType: mime }
    }
    case 'sticker': {
      const { url, mime } = await store(message.sticker?.mime_type)
      return { ...empty, mediaUrl: url, mediaType: mime }
    }

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

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
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
  isGroup = false,
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingContact(supabaseAdmin(), accountId, phone)

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
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

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('Error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  whatsappConfigId?: string,
) {
  const { data: existing, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single()

  if (!findError && existing) {
    // Keep the conversation tagged with the number it's currently on, so
    // replies go out from the same line the customer reached.
    if (whatsappConfigId && existing.whatsapp_config_id !== whatsappConfigId) {
      await supabaseAdmin()
        .from('conversations')
        .update({ whatsapp_config_id: whatsappConfigId })
        .eq('id', existing.id)
      existing.whatsapp_config_id = whatsappConfigId
    }
    return { conversation: existing, created: false }
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

  if (createError) {
    console.error('Error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}
