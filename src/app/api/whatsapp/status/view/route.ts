import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'
import { markMessagesAsRead } from '@/lib/whatsapp/provider/evolution'

/**
 * POST /api/whatsapp/status/view  { ids: string[] }
 *
 * Marks the given (contact) statuses viewed: stamps viewed_at locally and
 * best-effort tells WhatsApp we've seen them (blue "seen" on the poster's
 * side). Idempotent — only unseen rows are touched.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

  const { ids } = (await request.json().catch(() => ({}))) as { ids?: string[] }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: updated, error } = await admin
    .from('status_updates')
    .update({ viewed_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .in('id', ids)
    .is('viewed_at', null)
    .eq('is_mine', false)
    .select('message_id')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Best-effort: send a WhatsApp read receipt for the newly-seen statuses.
  const messageIds = (updated ?? []).map((r) => r.message_id).filter(Boolean)
  if (messageIds.length > 0) {
    try {
      const instanceName = await getDefaultInstanceName(admin, accountId)
      if (instanceName) {
        await markMessagesAsRead({
          instanceName,
          keys: messageIds.map((id) => ({
            remoteJid: 'status@broadcast',
            fromMe: false,
            id,
          })),
        })
      }
    } catch {
      // Non-fatal — the local viewed_at stamp is what the UI relies on.
    }
  }

  return NextResponse.json({ success: true, viewed: messageIds.length })
}
