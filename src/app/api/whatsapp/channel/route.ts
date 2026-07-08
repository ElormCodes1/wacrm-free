import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createNewsletter } from '@/lib/whatsapp/provider/evolution'

/** Resolve the account + its default connected WhatsApp config (id + instance). */
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

/** GET — list the account's channels. */
export async function GET() {
  const ctx = await resolveCtx()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { data, error } = await ctx.supabase
    .from('channels')
    .select('*')
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ channels: data ?? [] })
}

/** POST { name, description? } — create a channel and store it. */
export async function POST(request: Request) {
  const ctx = await resolveCtx()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  if (!ctx.config?.instance_name) {
    return NextResponse.json({ error: 'WhatsApp is not connected.' }, { status: 400 })
  }
  const { name, description } = (await request.json().catch(() => ({}))) as {
    name?: string
    description?: string
  }
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  let created
  try {
    created = await createNewsletter({
      instanceName: ctx.config.instance_name,
      name: name.trim(),
      description: description?.trim() || undefined,
    })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to create channel'
    return NextResponse.json({ error: m }, { status: 502 })
  }

  const { data: row, error } = await ctx.supabase
    .from('channels')
    .insert({
      account_id: ctx.accountId,
      whatsapp_config_id: ctx.config.id,
      newsletter_jid: created.id,
      name: name.trim(),
      description: description?.trim() || null,
      invite_code: created.invite ?? null,
      is_owner: true,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ channel: row })
}
