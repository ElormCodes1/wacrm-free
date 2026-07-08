import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { archiveChat, markChatUnread, pinChat, muteChat, clearChat } from '@/lib/whatsapp/provider/evolution'
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

    const { conversation_id, action, hours } = (await request.json().catch(() => ({}))) as {
      conversation_id?: string
      action?: string
      /** For 'mute' — how long to mute; omitted/0 = indefinitely. */
      hours?: number
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

    if (action === 'hide' || action === 'unhide') {
      // CRM-local only — no WhatsApp mirror. Hidden conversations drop out
      // of every inbox view; you handle those chats inside WhatsApp itself.
      await supabase
        .from('conversations')
        .update({ hidden_at: action === 'hide' ? now : null, updated_at: now })
        .eq('id', conversation_id)
      return NextResponse.json({ success: true })
    }

    if (action === 'pin' || action === 'unpin') {
      // Orders your inbox work queue; best-effort mirrored to WhatsApp so the
      // phone's chat list stays in sync.
      await supabase
        .from('conversations')
        .update({ pinned_at: action === 'pin' ? now : null, updated_at: now })
        .eq('id', conversation_id)
      const target = await resolveSendTarget(supabase, accountId, conversation_id)
      if (target) {
        try {
          await pinChat({
            instanceName: target.instanceName,
            chatJid: target.remoteJid,
            pin: action === 'pin',
          })
        } catch {
          /* local pin already applied */
        }
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'mute' || action === 'unmute') {
      // Mutes unread emphasis. `hours` limits the duration; omitted = a
      // far-future sentinel (indefinite). Best-effort mirrored to WhatsApp.
      const durationMs =
        hours && hours > 0 ? hours * 3_600_000 : 365 * 24 * 3_600_000
      const muted_until =
        action === 'mute'
          ? new Date(Date.now() + durationMs).toISOString()
          : null
      await supabase
        .from('conversations')
        .update({ muted_until, updated_at: now })
        .eq('id', conversation_id)
      const target = await resolveSendTarget(supabase, accountId, conversation_id)
      if (target) {
        try {
          await muteChat({
            instanceName: target.instanceName,
            chatJid: target.remoteJid,
            mute: action === 'mute' ? durationMs : null,
          })
        } catch {
          /* local mute already applied */
        }
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'clear') {
      // Clear the connected phone's WhatsApp copy of this chat (chatModify
      // clear). The CRM keeps its full record — this only declutters the
      // phone. No local DB change.
      const target = await resolveSendTarget(supabase, accountId, conversation_id)
      if (!target) {
        return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
      }
      // Supply the latest message ourselves — Evolution's getLastMessage
      // fallback is broken, so the clear needs a message key + timestamp.
      const { data: last } = await supabase
        .from('messages')
        .select('message_id, sender_type, created_at')
        .eq('conversation_id', conversation_id)
        .not('message_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!last?.message_id) {
        // Nothing on WhatsApp to clear.
        return NextResponse.json({ success: true })
      }
      try {
        await clearChat({
          instanceName: target.instanceName,
          chatJid: target.remoteJid,
          lastMessageKey: {
            id: last.message_id as string,
            remoteJid: target.remoteJid,
            fromMe: last.sender_type === 'agent' || last.sender_type === 'bot',
          },
          lastMessageTimestamp: Math.floor(new Date(last.created_at as string).getTime() / 1000),
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Clear failed'
        return NextResponse.json({ error: `WhatsApp clear failed: ${message}` }, { status: 502 })
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'delete') {
      // Hard delete from the CRM. messages (+ their reactions) cascade off
      // the conversation FK; tasks referencing it are SET NULL. CRM-local —
      // the chat stays on the phone's WhatsApp.
      await supabase.from('conversations').delete().eq('id', conversation_id)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: `Unsupported action "${action}"` }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
