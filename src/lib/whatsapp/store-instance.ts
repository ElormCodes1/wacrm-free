import { createClient } from '@/lib/supabase/server'
import { fetchOwnBusinessProfile } from '@/lib/whatsapp/provider/evolution'

export type StoreInstance =
  | { instanceName: string; isBusiness: boolean; accountId: string; configId: string | null }
  | { error: string; status: 400 | 401 | 403 }

/**
 * Resolve which connected number the Store should operate on. An account can
 * have several linked numbers (personal + business); the catalog lives on the
 * WhatsApp *Business* one, so we probe the open instances and prefer the first
 * that reports `isBusiness`. Falls back to the first open instance (so the UI
 * can still show the "not a Business account" state) when none are Business.
 */
export async function resolveStoreInstance(): Promise<StoreInstance> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return { error: 'No account', status: 403 }

  const { data: configs } = await supabase
    .from('whatsapp_config')
    .select('id, instance_name, connection_state')
    .eq('account_id', accountId)
    .not('instance_name', 'is', null)
    .order('created_at', { ascending: true })

  const open = (configs ?? [])
    .filter((c) => c.connection_state === 'open' && c.instance_name)
    .map((c) => ({ instanceName: c.instance_name as string, configId: c.id as string }))
  if (open.length === 0) return { error: 'WhatsApp is not connected.', status: 400 }

  // Prefer a Business number — that's the one that can have a catalog.
  for (const { instanceName, configId } of open) {
    try {
      const prof = await fetchOwnBusinessProfile({ instanceName })
      if (prof.isBusiness) return { instanceName, isBusiness: true, accountId, configId }
    } catch {
      /* skip an instance that fails to report */
    }
  }
  return { instanceName: open[0].instanceName, isBusiness: false, accountId, configId: open[0].configId }
}
