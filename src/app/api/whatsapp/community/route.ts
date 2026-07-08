import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCommunity, communityInviteCode } from '@/lib/whatsapp/provider/evolution'

async function resolveCtx() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return { error: 'No account', status: 403 as const }
  const { data: configs } = await supabase
    .from('whatsapp_config')
    .select('id, instance_name, connection_state')
    .eq('account_id', accountId)
    .not('instance_name', 'is', null)
    .order('created_at', { ascending: true })
  const config = configs?.find((c) => c.connection_state === 'open') ?? configs?.[0]
  return { supabase, accountId, config }
}

/** GET — list the account's communities. */
export async function GET() {
  const ctx = await resolveCtx()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { data, error } = await ctx.supabase
    .from('communities')
    .select('*')
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ communities: data ?? [] })
}

/** POST { subject, description? } — create a community and store it. */
export async function POST(request: Request) {
  const ctx = await resolveCtx()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  if (!ctx.config?.instance_name) {
    return NextResponse.json({ error: 'WhatsApp is not connected.' }, { status: 400 })
  }
  const { subject, description } = (await request.json().catch(() => ({}))) as {
    subject?: string
    description?: string
  }
  if (!subject?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  let created
  try {
    created = await createCommunity({
      instanceName: ctx.config.instance_name,
      subject: subject.trim(),
      description: description?.trim() || undefined,
    })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to create community'
    return NextResponse.json({ error: m }, { status: 502 })
  }

  // Best-effort invite code for the new community.
  let inviteCode: string | null = null
  try {
    const inv = await communityInviteCode({
      instanceName: ctx.config.instance_name,
      jid: created.id,
    })
    inviteCode = inv.inviteCode ?? null
  } catch {
    /* invite code is optional */
  }

  const { data: row, error } = await ctx.supabase
    .from('communities')
    .insert({
      account_id: ctx.accountId,
      whatsapp_config_id: ctx.config.id,
      community_jid: created.id,
      subject: subject.trim(),
      description: description?.trim() || null,
      invite_code: inviteCode,
      is_owner: true,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ community: row })
}
