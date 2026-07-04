// Shared helpers for multi-number routing: resolve which Evolution
// instance a send should go out from, account-scoped.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SendTarget {
  instanceName: string
  toDigits: string
  remoteJid: string
  contactPhone: string
}

/**
 * The account's default number's instance name — used by account-level
 * actions (profile, status, label sync, history import) that aren't tied
 * to a specific conversation. Prefers an open number, else the first.
 */
export async function getDefaultInstanceName(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data: rows } = await db
    .from('whatsapp_config')
    .select('instance_name, connection_state')
    .eq('account_id', accountId)
    .not('instance_name', 'is', null)
    .order('created_at', { ascending: true })
  if (!rows || rows.length === 0) return null
  const open = rows.find((r) => r.connection_state === 'open')
  return (open ?? rows[0]).instance_name as string
}

/**
 * Resolve the send target for a conversation: the recipient digits + the
 * instance of the number the conversation is on (falling back to the
 * account default). Returns null if it can't be resolved.
 */
export async function resolveSendTarget(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<SendTarget | null> {
  const { data: conversation } = await db
    .from('conversations')
    .select('id, account_id, whatsapp_config_id, contact:contacts(phone, is_group)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!conversation) return null

  const contact = Array.isArray(conversation.contact)
    ? conversation.contact[0]
    : conversation.contact
  const phone: string | undefined = contact?.phone
  if (!phone) return null

  const instanceName = await instanceForConversation(
    db,
    accountId,
    conversation.whatsapp_config_id as string | null,
  )
  if (!instanceName) return null

  const digits = phone.replace(/\D/g, '')
  // Groups are addressed by the group id + @g.us; 1:1 by @s.whatsapp.net.
  const isGroup = contact?.is_group === true
  const remoteJid = isGroup ? `${digits}@g.us` : `${digits}@s.whatsapp.net`
  return {
    instanceName,
    // Evolution's `number` field accepts a full JID; for groups we must
    // pass the group JID so the send targets the group, not a phone.
    toDigits: isGroup ? remoteJid : digits,
    remoteJid,
    contactPhone: phone,
  }
}

/** Instance name for a conversation's number, or the account default. */
export async function instanceForConversation(
  db: SupabaseClient,
  accountId: string,
  whatsappConfigId: string | null,
): Promise<string | null> {
  if (whatsappConfigId) {
    const { data } = await db
      .from('whatsapp_config')
      .select('instance_name')
      .eq('id', whatsappConfigId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (data?.instance_name) return data.instance_name
  }
  return getDefaultInstanceName(db, accountId)
}
