import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pinMessage } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'

/** Allowed pin durations (seconds): 24h / 7d / 30d. */
const DURATIONS = new Set([86400, 604800, 2592000])

/**
 * POST /api/whatsapp/message/pin
 *   { message_row_id, action: 'pin'|'unpin', duration?: 86400|604800|2592000 }
 *
 * Pins/unpins a message in its conversation on WhatsApp (visible to the
 * contact) and records the expiry in `messages.pinned_until` so the thread
 * can show a 📌 indicator. Default pin duration is 7 days.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

    const { message_row_id, action, duration } = (await request.json().catch(() => ({}))) as {
      message_row_id?: string
      action?: string
      duration?: number
    }
    if (!message_row_id || (action !== 'pin' && action !== 'unpin')) {
      return NextResponse.json({ error: 'message_row_id and a valid action are required' }, { status: 400 })
    }
    const dur = (duration && DURATIONS.has(duration) ? duration : 604800) as 86400 | 604800 | 2592000

    const { data: msg } = await supabase
      .from('messages')
      .select('message_id, sender_type, conversation_id')
      .eq('id', message_row_id)
      .maybeSingle()
    if (!msg?.message_id || !msg.conversation_id) {
      return NextResponse.json({ error: 'Message not found or has no WhatsApp id' }, { status: 404 })
    }

    const target = await resolveSendTarget(supabase, accountId, msg.conversation_id)
    if (!target) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    try {
      await pinMessage({
        instanceName: target.instanceName,
        to: target.toDigits,
        chatJid: target.remoteJid,
        messageId: msg.message_id as string,
        fromMe: msg.sender_type === 'agent' || msg.sender_type === 'bot',
        action,
        duration: action === 'pin' ? dur : undefined,
      })
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Pin failed'
      return NextResponse.json({ error: `WhatsApp pin failed: ${m}` }, { status: 502 })
    }

    const pinnedUntil =
      action === 'pin' ? new Date(Date.now() + dur * 1000).toISOString() : null
    const { error: updErr } = await supabase
      .from('messages')
      .update({ pinned_until: pinnedUntil })
      .eq('id', message_row_id)
    if (updErr) {
      return NextResponse.json(
        { error: `Pinned on WhatsApp but failed to save: ${updErr.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, pinned_until: pinnedUntil })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
