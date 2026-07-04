import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendLocation,
  sendContact,
  sendPoll,
  type ContactCard,
} from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * POST /api/whatsapp/send-rich
 *
 * Sends a richer message type (location / contact / poll) into a
 * conversation and persists it. Body:
 *   { conversation_id, kind: 'location', latitude, longitude, name?, address? }
 *   { conversation_id, kind: 'contact', contacts: ContactCard[] }
 *   { conversation_id, kind: 'poll', name, values, selectableCount? }
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await request.json().catch(() => ({}))) as any
    const conversationId: string | undefined = body.conversation_id
    const kind: string | undefined = body.kind
    if (!conversationId || !kind) {
      return NextResponse.json({ error: 'conversation_id and kind required' }, { status: 400 })
    }

    const target = await resolveSendTarget(supabase, accountId, conversationId)
    if (!target) {
      return NextResponse.json({ error: 'WhatsApp not connected or conversation not found.' }, { status: 400 })
    }

    let messageId: string
    let contentType: 'location' | 'contact' | 'poll'
    let preview: string

    try {
      if (kind === 'location') {
        const { latitude, longitude, name, address } = body
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
          return NextResponse.json({ error: 'latitude and longitude are required numbers' }, { status: 400 })
        }
        const r = await sendLocation({
          instanceName: target.instanceName,
          to: target.toDigits,
          latitude,
          longitude,
          name,
          address,
        })
        messageId = r.messageId
        contentType = 'location'
        preview = [name, address, `${latitude},${longitude}`].filter(Boolean).join(' - ')
      } else if (kind === 'contact') {
        const contacts = body.contacts as ContactCard[] | undefined
        if (!Array.isArray(contacts) || contacts.length === 0) {
          return NextResponse.json({ error: 'contacts[] is required' }, { status: 400 })
        }
        const r = await sendContact({
          instanceName: target.instanceName,
          to: target.toDigits,
          contacts,
        })
        messageId = r.messageId
        contentType = 'contact'
        preview = `Contact: ${contacts.map((c) => c.fullName).join(', ')}`
      } else if (kind === 'poll') {
        const { name, values, selectableCount } = body
        if (!name || !Array.isArray(values) || values.length < 2) {
          return NextResponse.json({ error: 'name and at least 2 values are required' }, { status: 400 })
        }
        const r = await sendPoll({
          instanceName: target.instanceName,
          to: target.toDigits,
          name,
          values,
          selectableCount,
        })
        messageId = r.messageId
        contentType = 'poll'
        preview = `Poll: ${name}`
      } else {
        return NextResponse.json({ error: `Unsupported kind "${kind}"` }, { status: 400 })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Send failed'
      return NextResponse.json({ error: `WhatsApp send failed: ${message}` }, { status: 502 })
    }

    // Persist as a message row so it shows in the thread.
    const { data: row, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: contentType,
        content_text: preview,
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
        last_message_text: preview,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({ success: true, message_id: row.id, whatsapp_message_id: messageId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error in send-rich:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
