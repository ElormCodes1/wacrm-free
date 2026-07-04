// ============================================================
// Chat-history import.
//
// Pulls existing chats + their recent messages off the connected number
// (Evolution stores them) and seeds the CRM inbox. Bounded so a large
// account doesn't time out or flood the DB. Media is NOT downloaded here
// (historical media is shown as a placeholder and fetched on demand);
// the goal is a populated inbox with who/when/text.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findChats,
  findMessages,
  jidToPhone,
} from '@/lib/whatsapp/provider/evolution'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'

const MAX_CHATS = 150
const MSGS_PER_CHAT = 15

interface ImportResult {
  chats: number
  contacts: number
  messages: number
}

/** Lightweight content extraction from a stored Baileys message (no media download). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractContent(m: any): { type: string; text: string | null } {
  const msg = m?.message ?? {}
  if (typeof msg.conversation === 'string') return { type: 'text', text: msg.conversation }
  if (msg.extendedTextMessage?.text != null) return { type: 'text', text: msg.extendedTextMessage.text }
  if (msg.imageMessage) return { type: 'image', text: msg.imageMessage.caption || '[image]' }
  if (msg.videoMessage) return { type: 'video', text: msg.videoMessage.caption || '[video]' }
  if (msg.audioMessage) return { type: 'audio', text: '[voice note]' }
  if (msg.documentMessage) return { type: 'document', text: msg.documentMessage.fileName || '[document]' }
  if (msg.stickerMessage) return { type: 'image', text: '[sticker]' }
  if (msg.locationMessage) return { type: 'location', text: '[location]' }
  if (msg.contactMessage || msg.contactsArrayMessage) return { type: 'contact', text: '[contact]' }
  if (msg.pollCreationMessage || msg.pollCreationMessageV3) return { type: 'poll', text: '[poll]' }
  return { type: 'text', text: null }
}

export async function importChatHistory(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  instanceName: string,
): Promise<ImportResult> {
  const result: ImportResult = { chats: 0, contacts: 0, messages: 0 }

  const chats = await findChats(instanceName)
  const individual = chats
    .filter((c) => {
      const jid: string = c.remoteJid ?? c.id ?? ''
      return jid.endsWith('@s.whatsapp.net')
    })
    .slice(0, MAX_CHATS)

  for (const chat of individual) {
    const jid: string = chat.remoteJid ?? chat.id
    const phone = normalizePhone(jidToPhone(jid))
    if (!phone) continue

    // Find or create the contact.
    let contactId: string
    const existing = await findExistingContact(db, accountId, phone)
    if (existing) {
      contactId = existing.id
    } else {
      const { data: created, error } = await db
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: auditUserId,
          phone,
          name: chat.pushName || phone,
          is_on_whatsapp: true,
          whatsapp_checked_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (error) {
        if (isUniqueViolation(error)) {
          const raced = await findExistingContact(db, accountId, phone)
          if (!raced) continue
          contactId = raced.id
        } else {
          continue
        }
      } else {
        contactId = created.id
        result.contacts++
      }
    }

    // Find or create the conversation.
    let conversationId: string
    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (conv) {
      conversationId = conv.id
    } else {
      const { data: newConv, error } = await db
        .from('conversations')
        .insert({ account_id: accountId, user_id: auditUserId, contact_id: contactId })
        .select('id')
        .single()
      if (error || !newConv) continue
      conversationId = newConv.id
    }
    result.chats++

    // Import recent messages (dedupe by message_id).
    const messages = await findMessages({ instanceName, remoteJid: jid, limit: MSGS_PER_CHAT })
    // Sort oldest→newest so last_message_at ends up correct.
    const sorted = [...messages].sort(
      (a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0),
    )
    let lastText: string | null = null
    let lastTs = 0
    for (const m of sorted) {
      const key = m.key
      if (!key?.id) continue
      const { data: dup } = await db
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('message_id', key.id)
        .maybeSingle()
      if (dup) continue

      const { type, text } = extractContent(m)
      const ts = Number(m.messageTimestamp ?? 0)
      const createdAt = ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString()
      const { error: insErr } = await db.from('messages').insert({
        conversation_id: conversationId,
        sender_type: key.fromMe ? 'agent' : 'customer',
        content_type: type,
        content_text: text,
        message_id: key.id,
        status: key.fromMe ? 'sent' : 'delivered',
        created_at: createdAt,
      })
      if (!insErr) {
        result.messages++
        lastText = text
        lastTs = ts
      }
    }

    if (lastTs > 0) {
      await db
        .from('conversations')
        .update({
          last_message_text: lastText || '[media]',
          last_message_at: new Date(lastTs * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
    }
  }

  return result
}
