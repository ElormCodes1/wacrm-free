// Group routing helpers: turn a stored group id into a JID and resolve
// which Evolution instance (number) a group operation should run from.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getDefaultInstanceName,
  instanceForConversation,
} from './resolve-send-target'

/** A group contact stores the group id (digits) as its `phone`. */
export function groupJidFromId(groupId: string): string {
  return `${groupId.replace(/\D/g, '')}@g.us`
}

/**
 * Resolve the instance for a group operation. Prefer the passed configId
 * (the group conversation's number); else find the group's conversation to
 * learn its number; else fall back to the account default number.
 */
export async function instanceForGroup(
  db: SupabaseClient,
  accountId: string,
  groupId: string,
  configId?: string | null,
): Promise<string | null> {
  if (configId) {
    const inst = await instanceForConversation(db, accountId, configId)
    if (inst) return inst
  }

  const digits = groupId.replace(/\D/g, '')
  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_group', true)
    .eq('phone', digits)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (contact?.id) {
    const { data: conv } = await db
      .from('conversations')
      .select('whatsapp_config_id')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const inst = await instanceForConversation(
      db,
      accountId,
      (conv?.whatsapp_config_id as string | null) ?? null,
    )
    if (inst) return inst
  }

  return getDefaultInstanceName(db, accountId)
}
