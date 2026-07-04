import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendText, sendMedia, type EvolutionMediaKind } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'

const MEDIA_KINDS = new Set(['image', 'video', 'document', 'audio'])

/**
 * POST /api/whatsapp/message/{id}/forward  { to_conversation_id }
 *
 * Forwards a message's content into another existing conversation.
 * (Evolution has no native forward, so the content is re-sent.)
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
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

    const { to_conversation_id } = (await request.json().catch(() => ({}))) as {
      to_conversation_id?: string
    }
    if (!to_conversation_id) {
      return NextResponse.json({ error: 'to_conversation_id required' }, { status: 400 })
    }

    // Source message (account-scoped via its conversation).
    const { data: msg } = await supabase
      .from('messages')
      .select('id, content_type, content_text, media_url, conversations!inner(account_id)')
      .eq('id', id)
      .maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const srcConv = (Array.isArray(msg?.conversations) ? msg?.conversations[0] : msg?.conversations) as any
    if (!msg || srcConv?.account_id !== accountId) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const target = await resolveSendTarget(supabase, accountId, to_conversation_id)
    if (!target) {
      return NextResponse.json({ error: 'Target conversation not found or WhatsApp not connected.' }, { status: 400 })
    }

    let whatsappId: string
    try {
      if (MEDIA_KINDS.has(msg.content_type) && msg.media_url) {
        const r = await sendMedia({
          instanceName: target.instanceName,
          to: target.toDigits,
          kind: msg.content_type as EvolutionMediaKind,
          media: msg.media_url,
          caption: msg.content_text || undefined,
        })
        whatsappId = r.messageId
      } else {
        const r = await sendText({
          instanceName: target.instanceName,
          to: target.toDigits,
          text: msg.content_text || '[forwarded message]',
        })
        whatsappId = r.messageId
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Forward failed'
      return NextResponse.json({ error: `Forward failed: ${message}` }, { status: 502 })
    }

    const contentType = MEDIA_KINDS.has(msg.content_type) ? msg.content_type : 'text'
    await supabase.from('messages').insert({
      conversation_id: to_conversation_id,
      sender_type: 'agent',
      content_type: contentType,
      content_text: msg.content_text,
      media_url: MEDIA_KINDS.has(msg.content_type) ? msg.media_url : null,
      message_id: whatsappId,
      status: 'sent',
    })
    await supabase
      .from('conversations')
      .update({
        last_message_text: msg.content_text || `[${contentType}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', to_conversation_id)

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
