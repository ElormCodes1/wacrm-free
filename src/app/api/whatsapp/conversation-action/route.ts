import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { archiveChat, markChatUnread } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'

/**
 * POST /api/whatsapp/conversation-action
 *   { conversation_id, action: 'archive' | 'unarchive' | 'mark_unread' }
 *
 * Archive is CRM-local (hidden from the active inbox) and best-effort
 * mirrored to WhatsApp. Mark-unread bumps the local unread count and
 * best-effort marks the chat unread on WhatsApp.
 */
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
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

    const { conversation_id, action } = (await request.json().catch(() => ({}))) as {
      conversation_id?: string
      action?: string
    }
    if (!conversation_id || !action) {
      return NextResponse.json({ error: 'conversation_id and action required' }, { status: 400 })
    }

    // Verify ownership.
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversation_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    const now = new Date().toISOString()

    if (action === 'archive' || action === 'unarchive') {
      await supabase
        .from('conversations')
        .update({ archived_at: action === 'archive' ? now : null, updated_at: now })
        .eq('id', conversation_id)
      // Best-effort WhatsApp mirror.
      const target = await resolveSendTarget(supabase, accountId, conversation_id)
      if (target) {
        try {
          await archiveChat({
            instanceName: target.instanceName,
            chatJid: target.remoteJid,
            archive: action === 'archive',
          })
        } catch {
          /* local archive already applied */
        }
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'mark_unread') {
      await supabase
        .from('conversations')
        .update({ unread_count: 1, updated_at: now })
        .eq('id', conversation_id)
      const target = await resolveSendTarget(supabase, accountId, conversation_id)
      if (target) {
        try {
          await markChatUnread({ instanceName: target.instanceName, chatJid: target.remoteJid })
        } catch {
          /* local applied */
        }
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: `Unsupported action "${action}"` }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
