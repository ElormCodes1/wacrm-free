import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { importChatHistory } from '@/lib/whatsapp/history-import'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'

// History import can touch many chats — give it headroom.
export const maxDuration = 300

/**
 * POST /api/whatsapp/history/import
 *
 * Seeds the CRM inbox with the connected number's existing chats + recent
 * messages. Idempotent (dedupes by message id) so it's safe to re-run.
 */
export async function POST() {
  try {
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

    const instanceName = await getDefaultInstanceName(supabase, accountId)
    if (!instanceName) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    const result = await importChatHistory(supabase, accountId, user.id, instanceName)

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error importing history:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
