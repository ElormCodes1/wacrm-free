import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { newsletterMetadata, followNewsletter } from '@/lib/whatsapp/provider/evolution'

/** POST { invite } — add an existing channel by its invite link/code. */
export async function POST(request: Request) {
  try {
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

    const { data: configs } = await supabase
      .from('whatsapp_config')
      .select('id, instance_name, connection_state')
      .eq('account_id', accountId)
      .not('instance_name', 'is', null)
      .order('created_at', { ascending: true })
    const config = configs?.find((c) => c.connection_state === 'open') ?? configs?.[0]
    if (!config?.instance_name) {
      return NextResponse.json({ error: 'WhatsApp is not connected.' }, { status: 400 })
    }

    const { invite } = (await request.json().catch(() => ({}))) as { invite?: string }
    // Accept a full link or a bare code.
    const code = (invite ?? '').trim().replace(/^https?:\/\/(whatsapp\.com|wa\.me)\/channel\//i, '')
    if (!code) return NextResponse.json({ error: 'Invite link is required' }, { status: 400 })

    const meta = await newsletterMetadata({
      instanceName: config.instance_name,
      type: 'invite',
      key: code,
    })
    if (!meta?.id) {
      return NextResponse.json({ error: 'Channel not found for that link' }, { status: 404 })
    }

    try {
      await followNewsletter({ instanceName: config.instance_name, jid: meta.id })
    } catch {
      /* following is best-effort; still store it so it's manageable */
    }

    const name = meta.thread_metadata?.name?.text ?? meta.name ?? 'Channel'
    const description = meta.thread_metadata?.description?.text ?? meta.description ?? null
    const { data: row, error: insErr } = await supabase
      .from('channels')
      .upsert(
        {
          account_id: accountId,
          whatsapp_config_id: config.id,
          newsletter_jid: meta.id,
          name,
          description,
          invite_code: code,
          is_owner: false,
        },
        { onConflict: 'account_id,newsletter_jid' },
      )
      .select('*')
      .single()
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    return NextResponse.json({ channel: row })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to add channel'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}
