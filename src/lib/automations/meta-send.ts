import { sendText } from '@/lib/whatsapp/provider/evolution'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side sender (self-hosted Evolution backend).
//
// Sends the messages an automation's steps produce through the account's
// Evolution instance, using the service-role client (the engine has no
// cookies). "Template" steps render the local template body with their
// params and send as plain text — the free backend has no Meta template
// approval system (full snippet handling lands in the templates phase).
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. */
  accountId: string
  /** Author of the automation — audit only, not tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

export async function engineSendText(
  args: SendTextArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaEvolution({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaEvolution({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

/** Substitute {{1}}, {{2}}… placeholders in a template body. */
function renderTemplate(body: string, params?: string[]): string {
  const values = params ?? []
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
    const idx = Number(n) - 1
    return values[idx] ?? `{{${n}}}`
  })
}

async function sendViaEvolution(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope contact + config by account_id (service-role bypasses RLS).
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const instanceName = await getDefaultInstanceName(db, input.accountId)
  if (!instanceName) {
    throw new Error('WhatsApp not connected for this account')
  }
  const toDigits = sanitized.replace(/\D/g, '')

  // Resolve the outgoing text.
  let text: string
  if (input.kind === 'template') {
    const { data: tpl } = await db
      .from('message_templates')
      .select('body_text, footer_text')
      .eq('account_id', input.accountId)
      .eq('name', input.templateName)
      .eq('language', input.language || 'en_US')
      .maybeSingle()
    if (!tpl?.body_text) {
      throw new Error(`template "${input.templateName}" not found for this account`)
    }
    text = renderTemplate(tpl.body_text, input.params)
    if (tpl.footer_text) text += `\n\n${tpl.footer_text}`
  } else {
    text = input.text
  }

  const { messageId } = await sendText({ instanceName, to: toDigits, text })

  const content_type = input.kind === 'template' ? 'template' : 'text'
  const template_name = input.kind === 'template' ? input.templateName : null

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type,
    content_text: text,
    template_name,
    message_id: messageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to WhatsApp but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template' ? `[template:${input.templateName}]` : input.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: messageId }
}
