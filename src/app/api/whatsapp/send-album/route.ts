import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendAlbum, type AlbumItem } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/** Max items in one album (WhatsApp practical cap). */
const MAX_ITEMS = 10

/**
 * POST /api/whatsapp/send-album
 *
 * Sends 2+ photos/videos as a single grouped album into a conversation and
 * persists each item as its own image/video message (they render in order
 * in the thread; the recipient sees a grouped album). Body:
 *   { conversation_id, items: [{ type:'image'|'video', media_url, caption? }] }
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
      items?: Array<{ type?: string; media_url?: string; caption?: string }>
    }
    const conversationId = body.conversation_id
    const rawItems = Array.isArray(body.items) ? body.items : []
    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }

    const items = rawItems
      .filter((i) => (i.type === 'image' || i.type === 'video') && typeof i.media_url === 'string')
      .slice(0, MAX_ITEMS) as Array<{ type: 'image' | 'video'; media_url: string; caption?: string }>
    if (items.length < 2) {
      return NextResponse.json({ error: 'An album needs at least 2 photos/videos.' }, { status: 400 })
    }

    const target = await resolveSendTarget(supabase, accountId, conversationId)
    if (!target) {
      return NextResponse.json(
        { error: 'WhatsApp not connected or conversation not found.' },
        { status: 400 },
      )
    }

    let messageIds: string[]
    try {
      const albumItems: AlbumItem[] = items.map((i) => ({
        type: i.type,
        media: i.media_url,
        caption: i.caption,
      }))
      const r = await sendAlbum({ instanceName: target.instanceName, to: target.toDigits, media: albumItems })
      messageIds = r.messageIds
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Send failed'
      return NextResponse.json({ error: `WhatsApp send failed: ${message}` }, { status: 502 })
    }

    // Persist each item as an image/video message (in order). Match the
    // returned WhatsApp ids positionally when available.
    const rows = items.map((i, idx) => ({
      conversation_id: conversationId,
      sender_type: 'agent' as const,
      content_type: i.type,
      content_text: i.caption || null,
      media_url: i.media_url,
      message_id: messageIds[idx] ?? null,
      status: 'sent' as const,
    }))
    const { error: msgErr } = await supabase.from('messages').insert(rows)
    if (msgErr) {
      return NextResponse.json(
        { error: `Sent to WhatsApp but failed to save: ${msgErr.message}` },
        { status: 500 },
      )
    }

    await supabase
      .from('conversations')
      .update({
        last_message_text: `📷 Album (${items.length})`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({ success: true, count: items.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error in send-album:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
