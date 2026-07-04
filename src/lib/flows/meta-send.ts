import {
  sendText,
  sendMedia,
  type EvolutionMediaKind,
} from '@/lib/whatsapp/provider/evolution'
// Type-only: these describe the flow-builder's button/list node shapes.
// Interactive messages are rendered as numbered text on the free backend
// (Baileys does not reliably deliver native buttons/lists) — see Phase 5.
import type {
  InteractiveButton,
  InteractiveListSection,
} from '@/lib/whatsapp/interactive-types'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Flows-side sender (self-hosted Evolution backend).
//
// Emits the messages a flow's nodes produce — text, media, and
// (rendered-as-text) interactive prompts — through the account's
// Evolution instance and persists each as a `sender_type='bot'` row so
// the inbox reflects the bot's turn.
// ------------------------------------------------------------

/** Resolve the contact's send digits + the account's Evolution instance. */
async function loadSendTarget(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
): Promise<{ instanceName: string; toDigits: string; contactId: string }> {
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const instanceName = await getDefaultInstanceName(db, accountId)
  if (!instanceName) {
    throw new Error('WhatsApp not connected for this account')
  }

  return {
    instanceName,
    toDigits: sanitized.replace(/\D/g, ''),
    contactId: contact.id,
  }
}

/** Persist a bot-sent message + bump the conversation preview. */
async function persistBotMessage(
  db: ReturnType<typeof supabaseAdmin>,
  args: {
    conversationId: string
    contentType: 'text' | EvolutionMediaKind | 'interactive'
    contentText: string | null
    preview: string
    messageId: string
  },
): Promise<void> {
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.contentType,
    content_text: args.contentText,
    message_id: args.messageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to WhatsApp but DB insert failed: ${msgErr.message}`)
  }
  await db
    .from('conversations')
    .update({
      last_message_text: args.preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)
}

interface SendTextEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
}

/** Send a plain-text WhatsApp message from the Flows engine. */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const { instanceName, toDigits } = await loadSendTarget(
    db,
    args.accountId,
    args.contactId,
  )

  const { messageId } = await sendText({
    instanceName,
    to: toDigits,
    text: args.text,
  })

  await persistBotMessage(db, {
    conversationId: args.conversationId,
    contentType: 'text',
    contentText: args.text,
    preview: args.text,
    messageId,
  })

  return { whatsapp_message_id: messageId }
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: EvolutionMediaKind
  /** Public URL or base64 the Evolution instance sends. */
  link: string
  caption?: string
  filename?: string
}

/** Send an image / video / document / audio from the Flows engine. */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const { instanceName, toDigits } = await loadSendTarget(
    db,
    args.accountId,
    args.contactId,
  )

  const { messageId } = await sendMedia({
    instanceName,
    to: toDigits,
    kind: args.kind,
    media: args.link,
    caption: args.caption,
    fileName: args.filename,
  })

  await persistBotMessage(db, {
    conversationId: args.conversationId,
    contentType: args.kind,
    contentText: args.caption ?? null,
    preview: args.caption?.trim() || `[${args.kind}]`,
    messageId,
  })

  return { whatsapp_message_id: messageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/**
 * Render an interactive prompt as numbered plain text.
 *
 * WhatsApp deprecated native buttons/lists for unofficial clients, so we
 * present the options as a numbered list and let the customer reply with
 * the number or the option text. Phase 5 refines reply-matching so the
 * flow's `collect_input` node maps these replies back to option ids.
 */
function renderInteractiveAsText(input: SendInput): string {
  const lines: string[] = []
  if (input.headerText) lines.push(`*${input.headerText}*`)
  lines.push(input.bodyText)
  lines.push('')
  if (input.kind === 'buttons') {
    input.buttons.forEach((b, i) => lines.push(`${i + 1}. ${b.title}`))
  } else {
    // Number rows CONTINUOUSLY across sections (not per-section) so the
    // number the customer types maps 1:1 to the flat option order the
    // engine matches against in matchReplyText.
    let n = 0
    input.sections.forEach((section) => {
      if (section.title) lines.push(`*${section.title}*`)
      section.rows.forEach((r) => {
        n += 1
        lines.push(`${n}. ${r.title}${r.description ? ` — ${r.description}` : ''}`)
      })
    })
  }
  lines.push('')
  lines.push('_Reply with the number or the option._')
  if (input.footerText) {
    lines.push('')
    lines.push(`_${input.footerText}_`)
  }
  return lines.join('\n')
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractive({ ...args, kind: 'buttons' })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractive({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractive(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const { instanceName, toDigits } = await loadSendTarget(
    db,
    input.accountId,
    input.contactId,
  )

  const text = renderInteractiveAsText(input)
  const { messageId } = await sendText({ instanceName, to: toDigits, text })

  // Persisted as content_type='interactive' so the inbox still tags it as
  // a prompt; interactive_reply_id is populated by the webhook on reply.
  await persistBotMessage(db, {
    conversationId: input.conversationId,
    contentType: 'interactive',
    contentText: input.bodyText,
    preview: input.bodyText,
    messageId,
  })

  return { whatsapp_message_id: messageId }
}
