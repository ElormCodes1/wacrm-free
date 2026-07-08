/**
 * Evolution API client — the self-hosted WhatsApp backend that replaces
 * Meta's Cloud API.
 *
 * Design notes:
 *  - Every WhatsApp connection is an "instance" (Evolution's term). One
 *    instance == one linked WhatsApp number. wacrm-free stores the
 *    instance name per account in `whatsapp_config.instance_name`.
 *  - Auth is a single global API key sent in the `apikey` header
 *    (Evolution's `AUTHENTICATION_API_KEY`). We do NOT use per-instance
 *    tokens here — the app server is trusted and holds the global key.
 *  - Like `meta-api.ts`, functions take a single named-arg object so a
 *    typo surfaces as a TypeScript error, not a runtime rejection.
 *
 * Config comes from the environment:
 *   EVOLUTION_API_URL   e.g. http://localhost:8088   (no trailing slash)
 *   EVOLUTION_API_KEY   the global apikey
 */

// ============================================================
// Config
// ============================================================

function evolutionConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  if (!baseUrl) {
    throw new Error(
      'EVOLUTION_API_URL is not set. Point it at your Evolution API server (e.g. http://localhost:8088).',
    )
  }
  if (!apiKey) {
    throw new Error(
      'EVOLUTION_API_KEY is not set. Use the global AUTHENTICATION_API_KEY from your Evolution server.',
    )
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey }
}

interface EvolutionErrorBody {
  status?: number
  error?: string
  message?: string | string[]
  response?: { message?: string | string[] }
}

/**
 * Perform a request against the Evolution API and parse JSON.
 * Throws an Error with a human-readable message on non-2xx.
 */
async function evolutionFetch<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<T> {
  const { baseUrl, apiKey } = evolutionConfig()
  const { body, headers, ...rest } = init
  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      apikey: apiKey,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    throw new Error(extractEvolutionError(data, response.status))
  }
  return data as T
}

/** Pull the most useful message out of Evolution's varied error shapes. */
function extractEvolutionError(data: unknown, status: number): string {
  const fallback = `Evolution API error: ${status}`
  if (!data || typeof data !== 'string' && typeof data !== 'object') return fallback
  if (typeof data === 'string') return data || fallback
  const body = data as EvolutionErrorBody
  const pick = (m?: string | string[]) =>
    Array.isArray(m) ? m.filter(Boolean).join('; ') : m
  return (
    pick(body.response?.message) ||
    pick(body.message) ||
    body.error ||
    fallback
  )
}

// ============================================================
// Instance / session management
// ============================================================

export type EvolutionConnectionState = 'open' | 'connecting' | 'close'

export interface EvolutionQr {
  /** Data-URL PNG of the QR code (`data:image/png;base64,...`). */
  base64?: string
  /** Raw QR string, if a client wants to render it itself. */
  code?: string
  /** Pairing code (8 chars) when the instance was created with a number. */
  pairingCode?: string | null
  count?: number
}

export interface EvolutionInstance {
  instanceName: string
  instanceId?: string
  status?: string
  /** Present on fetchInstances once connected. */
  ownerJid?: string | null
  profileName?: string | null
  profilePicUrl?: string | null
  number?: string | null
}

export interface WebhookConfig {
  url: string
  /** Event names in Evolution's UPPER_SNAKE form. */
  events: string[]
  /** Deliver each event to `{url}/{event-kebab}` instead of one URL. */
  byEvents?: boolean
  /** Include media as base64 in the payload. */
  base64?: boolean
  headers?: Record<string, string>
}

export interface CreateInstanceArgs {
  instanceName: string
  /** Optional E.164 number (digits only) — triggers a pairing code instead of a QR. */
  number?: string
  webhook?: WebhookConfig
}

export interface CreateInstanceResult {
  instance: EvolutionInstance
  /** Per-instance token Evolution generates (a.k.a. `hash`). Stored for reference. */
  hash?: string
  qrcode?: EvolutionQr
}

/**
 * Create a Baileys instance. Idempotent-ish: if the instance already
 * exists Evolution returns a 403 — callers should catch and fall back to
 * `connectInstance` to fetch a fresh QR.
 */
export async function createInstance(
  args: CreateInstanceArgs,
): Promise<CreateInstanceResult> {
  const { instanceName, number, webhook } = args
  const body: Record<string, unknown> = {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    // Required for status@broadcast traffic: Baileys' shouldIgnoreJid drops
    // ALL broadcast JIDs when readStatus is false, which kills both viewing
    // contacts' statuses AND receiving view receipts on our own statuses.
    readStatus: true,
  }
  if (number) body.number = number
  if (webhook) {
    body.webhook = {
      url: webhook.url,
      byEvents: webhook.byEvents ?? false,
      base64: webhook.base64 ?? true,
      events: webhook.events,
      ...(webhook.headers ? { headers: webhook.headers } : {}),
    }
  }
  const data = await evolutionFetch<{
    instance: { instanceName: string; instanceId?: string; status?: string }
    hash?: string | { apikey?: string }
    qrcode?: EvolutionQr
  }>('/instance/create', { method: 'POST', body })

  return {
    instance: {
      instanceName: data.instance.instanceName,
      instanceId: data.instance.instanceId,
      status: data.instance.status,
    },
    hash: typeof data.hash === 'string' ? data.hash : data.hash?.apikey,
    qrcode: data.qrcode,
  }
}

/**
 * (Re)connect an instance and fetch a fresh QR / pairing code. Called
 * when the instance exists but is not `open` (e.g. QR expired, or the
 * user is reconnecting after a logout).
 */
export async function connectInstance(args: {
  instanceName: string
  number?: string
}): Promise<EvolutionQr> {
  const { instanceName, number } = args
  const qs = number ? `?number=${encodeURIComponent(number)}` : ''
  // Evolution returns either { base64, code, pairingCode } or nests it
  // under { qrcode: {...} } depending on version — normalise both.
  const data = await evolutionFetch<
    EvolutionQr & { qrcode?: EvolutionQr }
  >(`/instance/connect/${encodeURIComponent(instanceName)}${qs}`)
  if (data.base64 || data.code || data.pairingCode) return data
  if (data.qrcode) return data.qrcode
  return data
}

export async function getConnectionState(
  instanceName: string,
): Promise<EvolutionConnectionState> {
  const data = await evolutionFetch<{
    instance?: { state?: EvolutionConnectionState }
  }>(`/instance/connectionState/${encodeURIComponent(instanceName)}`)
  return data.instance?.state ?? 'close'
}

/** Fetch a single instance's details (owner number, profile, status). */
export async function fetchInstance(
  instanceName: string,
): Promise<EvolutionInstance | null> {
  const data = await evolutionFetch<
    Array<{
      name?: string
      instanceName?: string
      id?: string
      connectionStatus?: string
      status?: string
      ownerJid?: string | null
      profileName?: string | null
      profilePicUrl?: string | null
      number?: string | null
    }>
  >(`/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`)
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return null
  return {
    instanceName: row.name ?? row.instanceName ?? instanceName,
    instanceId: row.id,
    status: row.connectionStatus ?? row.status,
    ownerJid: row.ownerJid ?? null,
    profileName: row.profileName ?? null,
    profilePicUrl: row.profilePicUrl ?? null,
    number: row.number ?? null,
  }
}

/** Log the linked device out (WhatsApp unlinks it) but keep the instance. */
export async function logoutInstance(instanceName: string): Promise<void> {
  await evolutionFetch(`/instance/logout/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE',
  })
}

/** Delete the instance entirely (removes its session + config on Evolution). */
export async function deleteInstance(instanceName: string): Promise<void> {
  await evolutionFetch(`/instance/delete/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE',
  })
}

export async function restartInstance(instanceName: string): Promise<void> {
  await evolutionFetch(`/instance/restart/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
  })
}

// ============================================================
// Webhook configuration
// ============================================================

/** Set (or replace) the webhook config for an instance. */
export async function setWebhook(args: {
  instanceName: string
  webhook: WebhookConfig
}): Promise<void> {
  const { instanceName, webhook } = args
  await evolutionFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true,
        url: webhook.url,
        byEvents: webhook.byEvents ?? false,
        base64: webhook.base64 ?? true,
        events: webhook.events,
        ...(webhook.headers ? { headers: webhook.headers } : {}),
      },
    },
  })
}

// ============================================================
// Helpers
// ============================================================

/** Strip a WhatsApp JID down to its phone digits (`2332...@s.whatsapp.net` → `2332...`). */
export function jidToPhone(jid: string | null | undefined): string {
  if (!jid) return ''
  return jid.split('@')[0]?.split(':')[0] ?? ''
}

/** Default event set wacrm-free subscribes to for inbound processing. */
export const DEFAULT_WEBHOOK_EVENTS = [
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  // Status view receipts (who viewed our status). Requires the patched
  // Evolution image — stock Evolution never emits this event.
  'MESSAGE_RECEIPT_UPDATE',
  'SEND_MESSAGE',
  'CONTACTS_UPSERT',
  // Profile changes (name/picture) — the array form of this event fires
  // when a contact updates their profile, so we can auto-refresh avatars.
  'CONTACTS_UPDATE',
  'CHATS_UPSERT',
  'CHATS_UPDATE',
  'CALL',
  'LABELS_EDIT',
  'LABELS_ASSOCIATION',
  'PRESENCE_UPDATE',
] as const

// ============================================================
// Messaging
//
// All send* helpers return the WhatsApp message id (Baileys `key.id`).
// That id is what wacrm-free persists in `messages.message_id` and
// correlates against MESSAGES_UPDATE (ack) webhook events.
// ============================================================

/** Shape of the `key` Evolution returns on a successful send. */
interface EvolutionSendResponse {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean }
  status?: string
  messageTimestamp?: number | string
}

export interface EvolutionSendResult {
  messageId: string
}

function messageIdFrom(res: EvolutionSendResponse): string {
  const id = res.key?.id
  if (!id) throw new Error('Evolution send returned no message id.')
  return id
}

export interface SendTextArgs {
  instanceName: string
  /** Recipient phone in digits (E.164 without `+`) or a full JID. */
  to: string
  text: string
  /** Message id being replied to — renders as a quoted reply. */
  quotedMessageId?: string
}

export async function sendText(args: SendTextArgs): Promise<EvolutionSendResult> {
  const { instanceName, to, text, quotedMessageId } = args
  const body: Record<string, unknown> = { number: to, text }
  if (quotedMessageId) body.quoted = { key: { id: quotedMessageId } }
  const res = await evolutionFetch<EvolutionSendResponse>(
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body },
  )
  return { messageId: messageIdFrom(res) }
}

export type EvolutionMediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendMediaArgs {
  instanceName: string
  to: string
  kind: EvolutionMediaKind
  /** A public URL or a base64 string of the file. */
  media: string
  caption?: string
  fileName?: string
  mimetype?: string
  quotedMessageId?: string
}

export async function sendMedia(args: SendMediaArgs): Promise<EvolutionSendResult> {
  const { instanceName, to, kind, media, caption, fileName, mimetype, quotedMessageId } = args
  if (!media) throw new Error('sendMedia requires a media URL or base64 string.')

  // Audio (voice notes) uses a dedicated endpoint in Evolution and takes
  // neither caption nor filename — it auto-renders as a playable note.
  if (kind === 'audio') {
    const res = await evolutionFetch<EvolutionSendResponse>(
      `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
      { method: 'POST', body: { number: to, audio: media } },
    )
    return { messageId: messageIdFrom(res) }
  }

  const body: Record<string, unknown> = {
    number: to,
    mediatype: kind,
    media,
  }
  if (caption) body.caption = caption
  if (fileName) body.fileName = fileName
  if (mimetype) body.mimetype = mimetype
  if (quotedMessageId) body.quoted = { key: { id: quotedMessageId } }

  const res = await evolutionFetch<EvolutionSendResponse>(
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body },
  )
  return { messageId: messageIdFrom(res) }
}

export interface SendPtvArgs {
  instanceName: string
  to: string
  /** A public URL or a base64 string of the (square, short) video. */
  video: string
  quotedMessageId?: string
}

/**
 * Send a PTV — a "video note", the round self-playing video WhatsApp
 * renders like a voice note. Evolution's dedicated `/message/sendPtv`
 * endpoint takes the raw video (no caption/filename); the recipient's
 * client draws it round. Socket-safe (a plain media send, verified live).
 */
export async function sendPtv(args: SendPtvArgs): Promise<EvolutionSendResult> {
  const { instanceName, to, video, quotedMessageId } = args
  if (!video) throw new Error('sendPtv requires a video URL or base64 string.')
  const body: Record<string, unknown> = { number: to, video }
  if (quotedMessageId) body.quoted = { key: { id: quotedMessageId } }
  const res = await evolutionFetch<EvolutionSendResponse>(
    `/message/sendPtv/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body },
  )
  return { messageId: messageIdFrom(res) }
}

export interface SendReactionArgs {
  instanceName: string
  to: string
  /** Message id being reacted to. */
  messageId: string
  fromMe: boolean
  /** Emoji, or '' to remove a reaction. */
  emoji: string
}

export async function sendReaction(args: SendReactionArgs): Promise<void> {
  const { instanceName, to, messageId, fromMe, emoji } = args
  await evolutionFetch(`/message/sendReaction/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      key: { remoteJid: to.includes('@') ? to : `${to}@s.whatsapp.net`, fromMe, id: messageId },
      reaction: emoji,
    },
  })
}

/**
 * Download an inbound media message as base64. Given the raw Baileys
 * message object (from a MESSAGES_UPSERT webhook), returns the decoded
 * bytes so wacrm-free can persist them to Supabase storage.
 */
export async function getBase64FromMediaMessage(args: {
  instanceName: string
  /** The Baileys message object (`data` from the webhook event). */
  message: unknown
  convertToMp4?: boolean
}): Promise<{ base64: string; mimetype?: string; fileName?: string }> {
  const { instanceName, message, convertToMp4 } = args
  const data = await evolutionFetch<{
    base64: string
    mimetype?: string
    fileName?: string
  }>(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: { message, convertToMp4: convertToMp4 ?? false },
  })
  return data
}

/** Check which of the given numbers actually have WhatsApp. */
export async function checkWhatsappNumbers(args: {
  instanceName: string
  numbers: string[]
}): Promise<Array<{ number: string; exists: boolean; jid?: string }>> {
  const { instanceName, numbers } = args
  const data = await evolutionFetch<
    Array<{ number?: string; exists?: boolean; jid?: string }>
  >(`/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: { numbers },
  })
  return (data ?? []).map((r) => ({
    number: r.number ?? '',
    exists: Boolean(r.exists),
    jid: r.jid,
  }))
}

// ============================================================
// Profile pictures / presence / read receipts
// ============================================================

/** Fetch a contact's WhatsApp profile-picture URL (null if none/private). */
export async function fetchProfilePictureUrl(args: {
  instanceName: string
  number: string
}): Promise<string | null> {
  const { instanceName, number } = args
  try {
    const data = await evolutionFetch<{
      wuid?: string
      profilePictureUrl?: string | null
    }>(`/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: { number },
    })
    return data?.profilePictureUrl ?? null
  } catch {
    // No picture / privacy-restricted / not found — treat as "no avatar".
    return null
  }
}

export type EvolutionPresence =
  | 'available'
  | 'unavailable'
  | 'composing'
  | 'recording'
  | 'paused'

/** Send a presence update (typing/recording) to a chat. Best-effort. */
export async function sendPresence(args: {
  instanceName: string
  to: string
  presence: EvolutionPresence
  /** How long (ms) to keep the presence before it clears. */
  delayMs?: number
}): Promise<void> {
  const { instanceName, to, presence, delayMs } = args
  await evolutionFetch(`/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: { number: to, presence, delay: delayMs ?? 1200 },
  })
}

/** Mark one or more messages as read (blue ticks). */
export async function markMessagesAsRead(args: {
  instanceName: string
  keys: Array<{ remoteJid: string; fromMe: boolean; id: string }>
}): Promise<void> {
  const { instanceName, keys } = args
  if (keys.length === 0) return
  await evolutionFetch(
    `/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body: { readMessages: keys } },
  )
}

// ============================================================
// Message lifecycle: delete-for-everyone, edit
// ============================================================

/** Delete a message for everyone (unsend). */
export async function deleteMessageForEveryone(args: {
  instanceName: string
  remoteJid: string
  fromMe: boolean
  id: string
  participant?: string
}): Promise<void> {
  const { instanceName, remoteJid, fromMe, id, participant } = args
  await evolutionFetch(
    `/chat/deleteMessageForEveryone/${encodeURIComponent(instanceName)}`,
    {
      method: 'DELETE',
      body: { id, remoteJid, fromMe, ...(participant ? { participant } : {}) },
    },
  )
}

/** Edit a previously-sent message's text (within WhatsApp's edit window). */
export async function updateMessageText(args: {
  instanceName: string
  to: string
  messageId: string
  text: string
}): Promise<void> {
  const { instanceName, to, messageId, text } = args
  const remoteJid = to.includes('@') ? to : `${to}@s.whatsapp.net`
  await evolutionFetch(`/chat/updateMessage/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: { number: to, key: { remoteJid, fromMe: true, id: messageId }, text },
  })
}

// ============================================================
// Richer message types: location, contact, poll
// ============================================================

export async function sendLocation(args: {
  instanceName: string
  to: string
  latitude: number
  longitude: number
  name?: string
  address?: string
}): Promise<EvolutionSendResult> {
  const { instanceName, to, latitude, longitude, name, address } = args
  const res = await evolutionFetch<EvolutionSendResponse>(
    `/message/sendLocation/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      body: { number: to, latitude, longitude, name: name ?? '', address: address ?? '' },
    },
  )
  return { messageId: messageIdFrom(res) }
}

export interface ContactCard {
  fullName: string
  /** Contact's WhatsApp number in digits. */
  phoneNumber: string
  /** Contact's WhatsApp id (usually `<digits>@s.whatsapp.net`). */
  wuid?: string
  organization?: string
  email?: string
  url?: string
}

export async function sendContact(args: {
  instanceName: string
  to: string
  contacts: ContactCard[]
}): Promise<EvolutionSendResult> {
  const { instanceName, to, contacts } = args
  const res = await evolutionFetch<EvolutionSendResponse>(
    `/message/sendContact/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      body: {
        number: to,
        contact: contacts.map((c) => ({
          fullName: c.fullName,
          wuid: c.wuid ?? `${c.phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`,
          phoneNumber: c.phoneNumber,
          ...(c.organization ? { organization: c.organization } : {}),
          ...(c.email ? { email: c.email } : {}),
          ...(c.url ? { url: c.url } : {}),
        })),
      },
    },
  )
  return { messageId: messageIdFrom(res) }
}

export async function sendPoll(args: {
  instanceName: string
  to: string
  name: string
  values: string[]
  /** How many options a voter may pick. Default 1. */
  selectableCount?: number
}): Promise<EvolutionSendResult> {
  const { instanceName, to, name, values, selectableCount } = args
  const res = await evolutionFetch<EvolutionSendResponse>(
    `/message/sendPoll/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      body: { number: to, name, selectableCount: selectableCount ?? 1, values },
    },
  )
  return { messageId: messageIdFrom(res) }
}

/** Send a sticker (webp URL or base64). */
export async function sendSticker(args: {
  instanceName: string
  to: string
  sticker: string
}): Promise<EvolutionSendResult> {
  const res = await evolutionFetch<EvolutionSendResponse>(
    `/message/sendSticker/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { number: args.to, sticker: args.sticker } },
  )
  return { messageId: messageIdFrom(res) }
}

// ============================================================
// Chat state: block, archive, mark unread
// ============================================================

export async function updateBlockStatus(args: {
  instanceName: string
  number: string
  block: boolean
}): Promise<void> {
  await evolutionFetch(
    `/chat/updateBlockStatus/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { number: args.number, status: args.block ? 'block' : 'unblock' } },
  )
}

export async function archiveChat(args: {
  instanceName: string
  chatJid: string
  archive: boolean
  lastMessageKey?: { id: string; remoteJid: string; fromMe: boolean }
}): Promise<void> {
  await evolutionFetch(
    `/chat/archiveChat/${encodeURIComponent(args.instanceName)}`,
    {
      method: 'POST',
      body: {
        chat: args.chatJid,
        archive: args.archive,
        ...(args.lastMessageKey ? { lastMessage: { key: args.lastMessageKey } } : {}),
      },
    },
  )
}

export async function markChatUnread(args: {
  instanceName: string
  chatJid: string
  lastMessageKey?: { id: string; remoteJid: string; fromMe: boolean }
}): Promise<void> {
  await evolutionFetch(
    `/chat/markChatUnread/${encodeURIComponent(args.instanceName)}`,
    {
      method: 'POST',
      body: {
        chat: args.chatJid,
        ...(args.lastMessageKey ? { lastMessage: { key: args.lastMessageKey } } : {}),
      },
    },
  )
}

/** Pin/unpin a chat on WhatsApp (chatModify). */
export async function pinChat(args: {
  instanceName: string
  chatJid: string
  pin: boolean
}): Promise<void> {
  await evolutionFetch(`/chat/pinChat/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { chat: args.chatJid, pin: args.pin },
  })
}

/** Mute a chat on WhatsApp for `durationMs`, or null to unmute (chatModify). */
export async function muteChat(args: {
  instanceName: string
  chatJid: string
  mute: number | null
}): Promise<void> {
  await evolutionFetch(`/chat/muteChat/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { chat: args.chatJid, mute: args.mute },
  })
}

/** Star/unstar a message on WhatsApp (chatModify). */
export async function starMessage(args: {
  instanceName: string
  chatJid: string
  messageId: string
  fromMe: boolean
  star: boolean
}): Promise<void> {
  await evolutionFetch(`/chat/starMessage/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: {
      chat: args.chatJid,
      messageId: args.messageId,
      fromMe: args.fromMe,
      star: args.star,
    },
  })
}

// ============================================================
// Newsletters / Channels
// ============================================================

export interface NewsletterInfo {
  id: string
  name?: string
  description?: string
  invite?: string
  subscribers?: number
  verification?: string
  mute_state?: string
  // fields from metadata reads (thread_metadata shape)
  thread_metadata?: {
    name?: { text?: string }
    description?: { text?: string }
    invite?: string
    subscribers_count?: string
  }
}

export async function createNewsletter(args: {
  instanceName: string
  name: string
  description?: string
}): Promise<NewsletterInfo> {
  return await evolutionFetch<NewsletterInfo>(
    `/newsletter/create/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { name: args.name, description: args.description } },
  )
}

export async function newsletterMetadata(args: {
  instanceName: string
  type: 'jid' | 'invite'
  key: string
}): Promise<NewsletterInfo | null> {
  try {
    return await evolutionFetch<NewsletterInfo>(
      `/newsletter/metadata/${encodeURIComponent(args.instanceName)}`,
      { method: 'POST', body: { type: args.type, key: args.key } },
    )
  } catch {
    return null
  }
}

export async function followNewsletter(args: {
  instanceName: string
  jid: string
}): Promise<void> {
  await evolutionFetch(`/newsletter/follow/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { jid: args.jid },
  })
}

export async function unfollowNewsletter(args: {
  instanceName: string
  jid: string
}): Promise<void> {
  await evolutionFetch(`/newsletter/unfollow/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { jid: args.jid },
  })
}

export async function updateNewsletter(args: {
  instanceName: string
  jid: string
  name?: string
  description?: string
}): Promise<void> {
  await evolutionFetch(`/newsletter/update/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { jid: args.jid, name: args.name, description: args.description },
  })
}

export async function deleteNewsletter(args: {
  instanceName: string
  jid: string
}): Promise<void> {
  await evolutionFetch(`/newsletter/delete/${encodeURIComponent(args.instanceName)}`, {
    method: 'DELETE',
    body: { jid: args.jid },
  })
}

// ============================================================
// Store / catalog (WhatsApp Business)
// ============================================================

export interface StoreProduct {
  id?: string
  name?: string
  description?: string
  price?: number
  currency?: string
  isHidden?: boolean
  retailerId?: string
  url?: string
  imageUrls?: string[]
}

export async function fetchCatalog(args: {
  instanceName: string
  number?: string
}): Promise<unknown> {
  return await evolutionFetch(`/business/getCatalog/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { number: args.number },
  })
}

/** Fetch the connected number's OWN business profile (incl. isBusiness). */
export async function fetchOwnBusinessProfile(args: {
  instanceName: string
  number?: string
}): Promise<{ isBusiness?: boolean } & Record<string, unknown>> {
  return await evolutionFetch(`/business/profile/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { number: args.number },
  })
}

export interface ProductInput {
  name: string
  price: number
  currency: string
  description?: string
  retailerId?: string
  url?: string
  isHidden?: boolean
  images: string[]
}

export async function createProduct(args: {
  instanceName: string
  product: ProductInput
}): Promise<unknown> {
  return await evolutionFetch(`/business/createProduct/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: args.product,
  })
}

export async function updateProduct(args: {
  instanceName: string
  productId: string
  product: ProductInput
}): Promise<unknown> {
  return await evolutionFetch(`/business/updateProduct/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { productId: args.productId, ...args.product },
  })
}

export async function deleteProduct(args: {
  instanceName: string
  productIds: string[]
}): Promise<unknown> {
  return await evolutionFetch(`/business/deleteProduct/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { productIds: args.productIds },
  })
}

// ============================================================
// Communities
// ============================================================

export interface CommunityInfo {
  id: string
  subject?: string
  desc?: string
  owner?: string
  size?: number
  linkedParent?: string
}

export async function createCommunity(args: {
  instanceName: string
  subject: string
  description?: string
}): Promise<CommunityInfo> {
  return await evolutionFetch<CommunityInfo>(
    `/community/create/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { subject: args.subject, description: args.description } },
  )
}

export async function communityMetadata(args: {
  instanceName: string
  jid: string
}): Promise<CommunityInfo | null> {
  try {
    return await evolutionFetch<CommunityInfo>(
      `/community/metadata/${encodeURIComponent(args.instanceName)}`,
      { method: 'POST', body: { jid: args.jid } },
    )
  } catch {
    return null
  }
}

export async function communityLinkedGroups(args: {
  instanceName: string
  jid: string
}): Promise<unknown> {
  return await evolutionFetch(
    `/community/linkedGroups/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { jid: args.jid } },
  )
}

export async function linkGroupToCommunity(args: {
  instanceName: string
  communityJid: string
  groupJid: string
}): Promise<void> {
  await evolutionFetch(`/community/linkGroup/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { communityJid: args.communityJid, groupJid: args.groupJid },
  })
}

export async function unlinkGroupFromCommunity(args: {
  instanceName: string
  communityJid: string
  groupJid: string
}): Promise<void> {
  await evolutionFetch(`/community/unlinkGroup/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { communityJid: args.communityJid, groupJid: args.groupJid },
  })
}

export async function updateCommunity(args: {
  instanceName: string
  jid: string
  subject?: string
  description?: string
}): Promise<void> {
  await evolutionFetch(`/community/update/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: { jid: args.jid, subject: args.subject, description: args.description },
  })
}

export async function communityInviteCode(args: {
  instanceName: string
  jid: string
}): Promise<{ inviteCode?: string; inviteUrl?: string | null }> {
  return await evolutionFetch(
    `/community/inviteCode/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { jid: args.jid } },
  )
}

export async function leaveCommunity(args: {
  instanceName: string
  jid: string
}): Promise<void> {
  await evolutionFetch(`/community/leave/${encodeURIComponent(args.instanceName)}`, {
    method: 'DELETE',
    body: { jid: args.jid },
  })
}

// ============================================================
// Profile: own + contact enrichment
// ============================================================

export interface WhatsAppProfile {
  wuid?: string
  name?: string
  numberExists?: boolean
  picture?: string | null
  status?: { status?: string; setAt?: string } | string | null
  isBusiness?: boolean
}

/** Fetch a contact's profile (name, status/about, picture, isBusiness). */
export async function fetchProfile(args: {
  instanceName: string
  number: string
}): Promise<WhatsAppProfile | null> {
  try {
    return await evolutionFetch<WhatsAppProfile>(
      `/chat/fetchProfile/${encodeURIComponent(args.instanceName)}`,
      { method: 'POST', body: { number: args.number } },
    )
  } catch {
    return null
  }
}

/** Fetch a contact's WhatsApp Business profile (category, website, hours…). */
export async function fetchBusinessProfile(args: {
  instanceName: string
  number: string
}): Promise<Record<string, unknown> | null> {
  try {
    const data = await evolutionFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      `/chat/fetchBusinessProfile/${encodeURIComponent(args.instanceName)}`,
      { method: 'POST', body: { number: args.number } },
    )
    const row = Array.isArray(data) ? data[0] : data
    return row ?? null
  } catch {
    return null
  }
}

export async function updateProfileName(args: {
  instanceName: string
  name: string
}): Promise<void> {
  await evolutionFetch(
    `/chat/updateProfileName/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { name: args.name } },
  )
}

export async function updateProfileStatus(args: {
  instanceName: string
  status: string
}): Promise<void> {
  await evolutionFetch(
    `/chat/updateProfileStatus/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { status: args.status } },
  )
}

export async function updateProfilePicture(args: {
  instanceName: string
  picture: string
}): Promise<void> {
  await evolutionFetch(
    `/chat/updateProfilePicture/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { picture: args.picture } },
  )
}

// ============================================================
// Labels
// ============================================================

export interface WhatsAppLabel {
  id: string
  name: string
  color?: string | number
}

export async function findLabels(instanceName: string): Promise<WhatsAppLabel[]> {
  try {
    const data = await evolutionFetch<WhatsAppLabel[]>(
      `/label/findLabels/${encodeURIComponent(instanceName)}`,
    )
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** Add or remove a WhatsApp label on a chat. */
export async function handleLabel(args: {
  instanceName: string
  number: string
  labelId: string
  action: 'add' | 'remove'
}): Promise<void> {
  await evolutionFetch(
    `/label/handleLabel/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: { number: args.number, labelId: args.labelId, action: args.action } },
  )
}

// ============================================================
// Status / Stories
// ============================================================

export async function sendStatus(args: {
  instanceName: string
  type: 'text' | 'image' | 'video' | 'audio'
  content: string
  caption?: string
  backgroundColor?: string
  /** Text-status font style (0-5). Evolution REQUIRES this for text. */
  font?: number
  /** Recipient JIDs; omit to post to all contacts. */
  statusJidList?: string[]
  allContacts?: boolean
}): Promise<EvolutionSendResult> {
  const { instanceName, type, content, caption, backgroundColor, font, statusJidList, allContacts } =
    args
  const body: Record<string, unknown> = { type, content }
  if (caption) body.caption = caption
  if (backgroundColor) body.backgroundColor = backgroundColor
  // Evolution requires a font for text statuses, and its check is
  // `if (!status.font)` — so 0 counts as missing. Coerce to 1-5.
  if (type === 'text') body.font = font && font >= 1 && font <= 5 ? font : 1
  if (allContacts) body.allContacts = true
  else if (statusJidList) body.statusJidList = statusJidList
  const res = await evolutionFetch<EvolutionSendResponse>(
    `/message/sendStatus/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body },
  )
  return { messageId: res.key?.id ?? '' }
}

// ============================================================
// Instance settings (reject-call, sync-history, auto-read…)
// ============================================================

export interface InstanceSettings {
  rejectCall?: boolean
  msgCall?: string
  groupsIgnore?: boolean
  alwaysOnline?: boolean
  readMessages?: boolean
  readStatus?: boolean
  syncFullHistory?: boolean
}

export async function getInstanceSettings(instanceName: string): Promise<InstanceSettings | null> {
  try {
    return await evolutionFetch<InstanceSettings>(
      `/settings/find/${encodeURIComponent(instanceName)}`,
    )
  } catch {
    return null
  }
}

export async function setInstanceSettings(args: {
  instanceName: string
  settings: InstanceSettings
}): Promise<void> {
  await evolutionFetch(`/settings/set/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: args.settings,
  })
}

// ============================================================
// History / chat + contact + message queries
// ============================================================

export interface GroupInfo {
  subject: string | null
  pictureUrl: string | null
  size: number | null
}

/** Fetch a WhatsApp group's metadata (name, picture, size). */
export async function fetchGroupInfo(
  instanceName: string,
  groupJid: string,
): Promise<GroupInfo | null> {
  try {
    const data = await evolutionFetch<Record<string, unknown>>(
      `/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
      { method: 'GET' },
    )
    if (!data) return null
    return {
      subject: (data.subject as string) ?? null,
      pictureUrl: (data.pictureUrl as string) ?? null,
      size: (data.size as number) ?? null,
    }
  } catch {
    return null
  }
}

// ============================================================
// Group management — full admin surface (/group/*). All group-scoped
// endpoints take the group JID as a ?groupJid= query param; POST bodies
// additionally carry it where Evolution's DTO expects it.
// ============================================================

export interface GroupParticipant {
  /** Display JID (may be an @lid when the member's number is private). */
  id: string
  /** Real phone digits when WhatsApp exposes them, else the LID digits. */
  phone: string
  /** True when a real @s.whatsapp.net number was provided (chat-able). */
  hasRealPhone: boolean
  admin: 'admin' | 'superadmin' | null
}

export interface GroupDetail {
  id: string
  subject: string | null
  description: string | null
  pictureUrl: string | null
  size: number | null
  owner: string | null
  /** announcement-only: only admins can send. */
  announce: boolean
  /** locked info: only admins can edit subject/description/picture. */
  restrict: boolean
  participants: GroupParticipant[]
}

export interface GroupSummary {
  id: string
  subject: string | null
  pictureUrl: string | null
  size: number | null
}

function groupPath(
  instanceName: string,
  endpoint: string,
  groupJid?: string,
): string {
  const base = `/group/${endpoint}/${encodeURIComponent(instanceName)}`
  return groupJid ? `${base}?groupJid=${encodeURIComponent(groupJid)}` : base
}

function participantsFrom(raw: unknown): GroupParticipant[] {
  if (!Array.isArray(raw)) return []
  return raw.map((p) => {
    const rec = (p ?? {}) as Record<string, unknown>
    const id = String(rec.id ?? '')
    // Newer WhatsApp exposes members as @lid but includes the real number
    // in `phoneNumber` (a @s.whatsapp.net JID) — prefer it when present.
    const realJid = typeof rec.phoneNumber === 'string' ? rec.phoneNumber : ''
    const hasRealPhone = realJid.includes('@s.whatsapp.net')
    return {
      id,
      phone: jidToPhone(hasRealPhone ? realJid : id),
      hasRealPhone,
      admin: (rec.admin as 'admin' | 'superadmin' | null) ?? null,
    }
  })
}

/** Full group detail incl. participants, admin roles, and settings. */
export async function fetchGroupDetail(
  instanceName: string,
  groupJid: string,
): Promise<GroupDetail | null> {
  try {
    const data = await evolutionFetch<Record<string, unknown>>(
      groupPath(instanceName, 'findGroupInfos', groupJid),
      { method: 'GET' },
    )
    if (!data) return null
    return {
      id: (data.id as string) ?? groupJid,
      subject: (data.subject as string) ?? null,
      description: (data.desc as string) ?? null,
      pictureUrl: (data.pictureUrl as string) ?? null,
      size: (data.size as number) ?? null,
      owner: (data.owner as string) ?? null,
      announce: data.announce === true,
      restrict: data.restrict === true,
      participants: participantsFrom(data.participants),
    }
  } catch {
    return null
  }
}

/** Every group the number belongs to (optionally with participants). */
export async function fetchAllGroups(
  instanceName: string,
  getParticipants = false,
): Promise<GroupSummary[]> {
  try {
    const data = await evolutionFetch<unknown>(
      `/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=${getParticipants}`,
      { method: 'GET' },
    )
    if (!Array.isArray(data)) return []
    return data.map((g) => {
      const rec = (g ?? {}) as Record<string, unknown>
      return {
        id: (rec.id as string) ?? '',
        subject: (rec.subject as string) ?? null,
        pictureUrl: (rec.pictureUrl as string) ?? null,
        size: (rec.size as number) ?? null,
      }
    })
  } catch {
    return []
  }
}

/** Create a group. participants = E.164 digits. Returns the new group JID. */
export async function createGroup(args: {
  instanceName: string
  subject: string
  participants: string[]
  description?: string
}): Promise<{ groupJid: string }> {
  const data = await evolutionFetch<Record<string, unknown>>(
    `/group/create/${encodeURIComponent(args.instanceName)}`,
    {
      method: 'POST',
      body: {
        subject: args.subject,
        participants: args.participants,
        ...(args.description ? { description: args.description } : {}),
      },
    },
  )
  return { groupJid: String(data.id ?? data.groupJid ?? '') }
}

export async function updateGroupSubject(
  instanceName: string,
  groupJid: string,
  subject: string,
): Promise<void> {
  await evolutionFetch(groupPath(instanceName, 'updateGroupSubject', groupJid), {
    method: 'POST',
    body: { groupJid, subject },
  })
}

export async function updateGroupDescription(
  instanceName: string,
  groupJid: string,
  description: string,
): Promise<void> {
  await evolutionFetch(
    groupPath(instanceName, 'updateGroupDescription', groupJid),
    { method: 'POST', body: { groupJid, description } },
  )
}

/** image = public URL or base64. */
export async function updateGroupPicture(
  instanceName: string,
  groupJid: string,
  image: string,
): Promise<void> {
  await evolutionFetch(groupPath(instanceName, 'updateGroupPicture', groupJid), {
    method: 'POST',
    body: { groupJid, image },
  })
}

export type GroupParticipantAction = 'add' | 'remove' | 'promote' | 'demote'

export async function updateGroupParticipants(
  instanceName: string,
  groupJid: string,
  action: GroupParticipantAction,
  participants: string[],
): Promise<void> {
  await evolutionFetch(groupPath(instanceName, 'updateParticipant', groupJid), {
    method: 'POST',
    body: { groupJid, action, participants },
  })
}

/** A person who has requested to join a group with admin approval on. */
export interface GroupPendingParticipant {
  /** Requester JID (may be @lid or @s.whatsapp.net). Pass back verbatim. */
  jid: string
  phone: string
}

/**
 * List the pending join requests for a group (admin-approval groups).
 * Backed by our patched Evolution `/group/pendingParticipants`
 * (Baileys `groupRequestParticipantsList`). Socket-safe (a group IQ read).
 */
export async function fetchGroupPendingParticipants(
  instanceName: string,
  groupJid: string,
): Promise<GroupPendingParticipant[]> {
  const data = await evolutionFetch<{ participants?: unknown }>(
    groupPath(instanceName, 'pendingParticipants', groupJid),
    { method: 'GET' },
  )
  const raw = Array.isArray(data?.participants) ? data.participants : []
  return raw.map((p) => {
    const rec = (p ?? {}) as Record<string, unknown>
    const jid = String(rec.jid ?? '')
    return { jid, phone: jidToPhone(jid) }
  })
}

/** Approve or reject pending join requests. Patched Evolution
 *  `/group/updatePendingParticipant` (Baileys
 *  `groupRequestParticipantsUpdate`). */
export async function updateGroupPendingParticipants(
  instanceName: string,
  groupJid: string,
  action: 'approve' | 'reject',
  participants: string[],
): Promise<void> {
  await evolutionFetch(groupPath(instanceName, 'updatePendingParticipant', groupJid), {
    method: 'POST',
    body: { groupJid, action, participants },
  })
}

export type GroupSettingAction =
  | 'announcement'
  | 'not_announcement'
  | 'locked'
  | 'unlocked'

export async function updateGroupSetting(
  instanceName: string,
  groupJid: string,
  action: GroupSettingAction,
): Promise<void> {
  await evolutionFetch(groupPath(instanceName, 'updateSetting', groupJid), {
    method: 'POST',
    body: { groupJid, action },
  })
}

export async function toggleGroupEphemeral(
  instanceName: string,
  groupJid: string,
  expiration: 0 | 86400 | 604800 | 7776000,
): Promise<void> {
  await evolutionFetch(groupPath(instanceName, 'toggleEphemeral', groupJid), {
    method: 'POST',
    body: { groupJid, expiration },
  })
}

export interface GroupInvite {
  code: string
  url: string
}

function inviteFrom(data: Record<string, unknown>): GroupInvite {
  const code = String(data.inviteCode ?? data.code ?? '')
  const url =
    (data.inviteUrl as string) ??
    (code ? `https://chat.whatsapp.com/${code}` : '')
  return { code, url }
}

export async function fetchGroupInviteCode(
  instanceName: string,
  groupJid: string,
): Promise<GroupInvite | null> {
  try {
    const data = await evolutionFetch<Record<string, unknown>>(
      groupPath(instanceName, 'inviteCode', groupJid),
      { method: 'GET' },
    )
    return inviteFrom(data)
  } catch {
    return null
  }
}

export async function revokeGroupInviteCode(
  instanceName: string,
  groupJid: string,
): Promise<GroupInvite | null> {
  try {
    const data = await evolutionFetch<Record<string, unknown>>(
      groupPath(instanceName, 'revokeInviteCode', groupJid),
      { method: 'POST', body: { groupJid } },
    )
    return inviteFrom(data)
  } catch {
    return null
  }
}

/** DM the group invite link to numbers (E.164 digits). */
export async function sendGroupInvite(args: {
  instanceName: string
  groupJid: string
  numbers: string[]
  description?: string
}): Promise<void> {
  await evolutionFetch(
    `/group/sendInvite/${encodeURIComponent(args.instanceName)}`,
    {
      method: 'POST',
      body: {
        groupJid: args.groupJid,
        numbers: args.numbers,
        description: args.description ?? '',
      },
    },
  )
}

export async function leaveGroup(
  instanceName: string,
  groupJid: string,
): Promise<void> {
  await evolutionFetch(groupPath(instanceName, 'leaveGroup', groupJid), {
    method: 'DELETE',
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findChats(instanceName: string): Promise<any[]> {
  try {
    const data = await evolutionFetch<unknown>(
      `/chat/findChats/${encodeURIComponent(instanceName)}`,
      { method: 'POST', body: {} },
    )
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findContacts(instanceName: string): Promise<any[]> {
  try {
    const data = await evolutionFetch<unknown>(
      `/chat/findContacts/${encodeURIComponent(instanceName)}`,
      { method: 'POST', body: {} },
    )
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

// ============================================================
// LID → phone resolution
//
// WhatsApp is migrating to opaque "LIDs". Calls (and some messages) are
// addressed by `<lid>@lid` with no phone. Evolution's chat records expose
// the real phone via `lastMessage.key.remoteJidAlt`, so we build a
// LID→phone map from findChats and cache it briefly.
// ============================================================

const lidCache = new Map<string, { map: Map<string, string>; ts: number }>()
const LID_TTL_MS = 5 * 60 * 1000

/** Resolve a `<lid>@lid` JID to its `<phone>@s.whatsapp.net`, or null. */
export async function resolveLid(
  instanceName: string,
  lidJid: string,
): Promise<string | null> {
  if (!lidJid.endsWith('@lid')) return lidJid
  const now = Date.now()
  let entry = lidCache.get(instanceName)
  if (!entry || now - entry.ts > LID_TTL_MS) {
    const map = new Map<string, string>()
    try {
      const chats = await findChats(instanceName)
      for (const c of chats) {
        const rj = String(c.remoteJid ?? c.id ?? '')
        const alt = c.lastMessage?.key?.remoteJidAlt
        if (rj.endsWith('@lid') && typeof alt === 'string' && alt.endsWith('@s.whatsapp.net')) {
          map.set(rj, alt)
        }
      }
    } catch {
      /* leave map empty; caller treats as unresolved */
    }
    entry = { map, ts: now }
    lidCache.set(instanceName, entry)
  }
  return entry.map.get(lidJid) ?? null
}

/** Query stored messages for a chat (for history backfill). */
export async function findMessages(args: {
  instanceName: string
  remoteJid: string
  limit?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any[]> {
  try {
    const data = await evolutionFetch<unknown>(
      `/chat/findMessages/${encodeURIComponent(args.instanceName)}`,
      {
        method: 'POST',
        body: { where: { key: { remoteJid: args.remoteJid } }, limit: args.limit ?? 50 },
      },
    )
    if (Array.isArray(data)) return data
    // Evolution may wrap: { messages: { records: [...] } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = (data as any)?.messages?.records ?? (data as any)?.records
    return Array.isArray(rec) ? rec : []
  } catch {
    return []
  }
}
