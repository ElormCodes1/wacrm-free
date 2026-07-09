import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Find the account's conversation for a contact, creating it if none
 * exists — so a CRM-initiated send (e.g. sharing a product from the Store)
 * lands in a real thread the agent can follow up in. Mirrors the inline
 * helper in the /send route; the (account_id, contact_id) unique index
 * makes the find→insert safe. Returns the conversation id, or null on error.
 */
export async function findOrCreateConversation(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing) return existing.id as string

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
    .select('id')
    .single()

  if (error) {
    // A concurrent insert may have won the (account_id, contact_id) unique
    // index — re-resolve the winner instead of failing.
    const { data: raced } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (raced) return raced.id as string
    console.error('Error creating conversation for contact send:', error.message)
    return null
  }

  return created.id as string
}
