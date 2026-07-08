import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendText } from '@/lib/whatsapp/provider/evolution'

/** POST { text } — broadcast a text post to the channel's subscribers. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

    const { text } = (await request.json().catch(() => ({}))) as { text?: string }
    if (!text?.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

    const { data: channel } = await supabase
      .from('channels')
      .select('newsletter_jid, config:whatsapp_config(instance_name)')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    const instanceName = (channel?.config as { instance_name?: string } | null)?.instance_name
    if (!channel || !instanceName) {
      return NextResponse.json({ error: 'Channel not found or not connected' }, { status: 404 })
    }

    const res = await sendText({
      instanceName,
      to: channel.newsletter_jid,
      text: text.trim(),
    })
    return NextResponse.json({ success: true, messageId: res.messageId })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to post'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}
