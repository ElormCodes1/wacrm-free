import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendStatus } from '@/lib/whatsapp/provider/evolution'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'

/**
 * POST /api/whatsapp/status
 *   { type: 'text' | 'image', content, caption?, backgroundColor? }
 *
 * Posts to WhatsApp Status (Stories) — visible to all contacts, no
 * per-contact send.
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
      type?: 'text' | 'image'
      content?: string
      caption?: string
      backgroundColor?: string
    }
    if (!type || !content) {
      return NextResponse.json({ error: 'type and content are required' }, { status: 400 })
    }

    const instanceName = await getDefaultInstanceName(supabase, accountId)
    if (!instanceName) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    try {
      await sendStatus({
        instanceName,
        type,
        content,
        caption,
        backgroundColor,
        allContacts: true,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Post failed'
      return NextResponse.json({ error: `Status post failed: ${message}` }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
