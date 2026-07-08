import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEvent } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'
import { formatEventSummary } from '@/lib/whatsapp/event-summary'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * POST /api/whatsapp/send-event
 *
 * Sends a WhatsApp calendar event (native RSVP invite) into a conversation
 * — e.g. scheduling an onboarding call with a contact — and persists it as
 * a content_type='event' message. Socket-safe (verified live). Body:
 *   { conversation_id, name, description?, start_time (unix s),
 *     end_time? (unix s), location? { latitude, longitude, name?, address? } }
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
      name?: string
      description?: string
      start_time?: number
      end_time?: number
      location?: { latitude: number; longitude: number; name?: string; address?: string }
    }
    const conversationId = body.conversation_id
    const name = body.name?.trim()
    const startTime = body.start_time
    if (!conversationId || !name || typeof startTime !== 'number') {
      return NextResponse.json(
        { error: 'conversation_id, name and start_time are required' },
        { status: 400 },
      )
    }
    if (body.end_time && body.end_time <= startTime) {
      return NextResponse.json({ error: 'end_time must be after start_time' }, { status: 400 })
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
      const r = await sendEvent({
        instanceName: target.instanceName,
        to: target.toDigits,
        name,
        description: body.description?.trim() || undefined,
        startTime,
        endTime: body.end_time,
        location: body.location,
      })
      messageId = r.messageId
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Send failed'
      return NextResponse.json({ error: `WhatsApp send failed: ${message}` }, { status: 502 })
    }

    const summary = formatEventSummary({
      name,
      description: body.description,
      startTime,
      endTime: body.end_time,
      location: body.location,
    })

    const { data: row, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'event',
        content_text: summary,
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
        last_message_text: `📅 ${name}`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({ success: true, message_id: row.id, whatsapp_message_id: messageId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error in send-event:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
