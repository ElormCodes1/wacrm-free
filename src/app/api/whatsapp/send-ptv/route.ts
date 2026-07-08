import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPtv } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * POST /api/whatsapp/send-ptv
 *
 * Sends a video note (PTV — the round, self-playing video WhatsApp draws
 * like a voice note) into a conversation and persists it. The clip is
 * already uploaded to chat-media by the composer; we pass its public URL
 * to Evolution's dedicated /message/sendPtv endpoint. Kept separate from
 * the shared send core (which is Meta-message-type shaped) because PTV is
 * an Evolution-native send with no caption/filename.
 *
 * Body: { conversation_id, media_url }
 * Stored as content_type='video' (a PTV is a video; the recipient's client
 * renders it round natively).
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

    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      conversation_id?: string
      media_url?: string
      reply_to_message_id?: string
    }
    const conversationId = body.conversation_id
    const mediaUrl = body.media_url
    if (!conversationId || !mediaUrl) {
      return NextResponse.json(
        { error: 'conversation_id and media_url are required' },
        { status: 400 },
      )
    }

    const target = await resolveSendTarget(supabase, accountId, conversationId)
    if (!target) {
      return NextResponse.json(
        { error: 'WhatsApp not connected or conversation not found.' },
        { status: 400 },
      )
    }

    let messageId: string
    try {
      const r = await sendPtv({
        instanceName: target.instanceName,
        to: target.toDigits,
        video: mediaUrl,
        quotedMessageId: body.reply_to_message_id,
      })
      messageId = r.messageId
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Send failed'
      return NextResponse.json(
        { error: `WhatsApp send failed: ${message}` },
        { status: 502 },
      )
    }

    // Persist so it shows in the thread. A PTV is a video; store it as one
    // (media_url points at the chat-media clip) so the bubble renders it.
    const { data: row, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'video',
        media_url: mediaUrl,
        message_id: messageId,
        status: 'sent',
      })
      .select('id')
      .single()
    if (msgErr) {
      return NextResponse.json(
        { error: `Sent to WhatsApp but failed to save: ${msgErr.message}` },
        { status: 500 },
      )
    }

    await supabase
      .from('conversations')
      .update({
        last_message_text: '🎥 Video note',
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({
      success: true,
      message_id: row.id,
      whatsapp_message_id: messageId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error in send-ptv:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
