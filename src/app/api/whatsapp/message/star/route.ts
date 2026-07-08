import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { starMessage } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'

/**
 * POST /api/whatsapp/message/star  { message_row_id, star }
 *
 * Mirrors a star/unstar to WhatsApp (chatModify). The CRM-local starred_at
 * flag is written client-side; this best-effort call keeps the phone in
 * sync. Never fails the caller — starring is a bookmark, not a delivery.
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

    const { message_row_id, star } = (await request.json().catch(() => ({}))) as {
      message_row_id?: string
      star?: boolean
    }
    if (!message_row_id || typeof star !== 'boolean') {
      return NextResponse.json({ error: 'message_row_id and star required' }, { status: 400 })
    }

    const { data: msg } = await supabase
      .from('messages')
      .select('message_id, sender_type, conversation_id')
      .eq('id', message_row_id)
      .maybeSingle()
    if (!msg?.message_id || !msg.conversation_id) {
      // No WhatsApp key (e.g. a synthetic/local row) — nothing to mirror.
      return NextResponse.json({ success: true, mirrored: false })
    }

    const target = await resolveSendTarget(supabase, accountId, msg.conversation_id)
    if (target) {
      try {
        await starMessage({
          instanceName: target.instanceName,
          chatJid: target.remoteJid,
          messageId: msg.message_id as string,
          fromMe: msg.sender_type === 'agent' || msg.sender_type === 'bot',
          star,
        })
      } catch {
        /* CRM-local star already applied */
      }
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
