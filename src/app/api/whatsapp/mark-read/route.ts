import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { markMessagesAsRead } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'

/**
 * POST /api/whatsapp/mark-read  { conversation_id }
 *
 * Marks the conversation's recent inbound (customer) messages as read on
 * WhatsApp (blue ticks). Called when an agent opens the thread. Bounded
 * to the most recent inbound messages; re-marking already-read messages
 * is harmless. Best-effort.
 */
const MAX_KEYS = 30

export async function POST(request: Request) {
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
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const { conversation_id } = (await request.json().catch(() => ({}))) as {
      conversation_id?: string
    }
    if (!conversation_id) {
      return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })
    }

    const target = await resolveSendTarget(supabase, accountId, conversation_id)
    if (!target) return NextResponse.json({ ok: false }, { status: 200 })

    // Most recent inbound (customer) messages with a WhatsApp id.
    const { data: msgs } = await supabase
      .from('messages')
      .select('message_id')
      .eq('conversation_id', conversation_id)
      .eq('sender_type', 'customer')
      .not('message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(MAX_KEYS)

    const keys = (msgs ?? [])
      .filter((m) => m.message_id)
      .map((m) => ({
        remoteJid: target.remoteJid,
        fromMe: false,
        id: m.message_id as string,
      }))

    if (keys.length > 0) {
      try {
        await markMessagesAsRead({ instanceName: target.instanceName, keys })
      } catch {
        // best-effort
      }
    }
    return NextResponse.json({ ok: true, marked: keys.length })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
