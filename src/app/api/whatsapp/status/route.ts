import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendStatus } from '@/lib/whatsapp/provider/evolution'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'

const STATUS_TTL_MS = 24 * 60 * 60 * 1000

/**
 * POST /api/whatsapp/status
 *   { type: 'text' | 'image' | 'video', content, caption?, backgroundColor? }
 *
 * Posts to WhatsApp Status (Stories) — visible to all contacts, no
 * per-contact send. Records a "My status" row immediately so it shows on
 * the Status page without waiting for the webhook echo.
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

    const { type, content, caption, backgroundColor } = (await request.json().catch(() => ({}))) as {
      type?: 'text' | 'image' | 'video'
      content?: string
      caption?: string
      backgroundColor?: string
    }
    if (!type || !['text', 'image', 'video'].includes(type)) {
      return NextResponse.json({ error: 'type must be text, image, or video' }, { status: 400 })
    }
    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    const instanceName = await getDefaultInstanceName(supabase, accountId)
    if (!instanceName) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    let messageId = ''
    try {
      const res = await sendStatus({
        instanceName,
        type,
        content,
        caption,
        backgroundColor,
        allContacts: true,
      })
      messageId = res.messageId
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Post failed'
      return NextResponse.json({ error: `Status post failed: ${message}` }, { status: 502 })
    }

    // Record "My status" immediately (webhook echo would arrive later and
    // is deduped by the UNIQUE(account_id, message_id) upsert).
    if (messageId) {
      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      const now = new Date()
      await admin.from('status_updates').upsert(
        {
          account_id: accountId,
          is_mine: true,
          content_type: type,
          content_text: type === 'text' ? content : caption || null,
          media_url: type === 'text' ? null : content,
          background_color: type === 'text' ? backgroundColor || null : null,
          message_id: messageId,
          posted_at: now.toISOString(),
          expires_at: new Date(now.getTime() + STATUS_TTL_MS).toISOString(),
        },
        { onConflict: 'account_id,message_id', ignoreDuplicates: true },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
