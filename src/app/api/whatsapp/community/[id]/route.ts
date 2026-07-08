import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateCommunity, leaveCommunity } from '@/lib/whatsapp/provider/evolution'

async function loadCommunity(id: string) {
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
  const { data: community } = await supabase
    .from('communities')
    .select('*, config:whatsapp_config(instance_name)')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!community) return { error: 'Community not found', status: 404 as const }
  const instanceName = (community.config as { instance_name?: string } | null)?.instance_name
  return { supabase, community, instanceName }
}

/** PATCH { subject?, description? } — rename / re-describe the community. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await loadCommunity(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { subject, description } = (await request.json().catch(() => ({}))) as {
    subject?: string
    description?: string
  }
  if (ctx.instanceName && ctx.community.is_owner) {
    try {
      await updateCommunity({
        instanceName: ctx.instanceName,
        jid: ctx.community.community_jid,
        subject: subject?.trim() || undefined,
        description: description?.trim(),
      })
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Update failed'
      return NextResponse.json({ error: m }, { status: 502 })
    }
  }
  const patch: Record<string, unknown> = {}
  if (subject !== undefined) patch.subject = subject.trim()
  if (description !== undefined) patch.description = description.trim() || null
  await ctx.supabase.from('communities').update(patch).eq('id', id)
  return NextResponse.json({ success: true })
}

/** DELETE — leave the community on WhatsApp, then drop the row. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await loadCommunity(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  if (ctx.instanceName) {
    try {
      await leaveCommunity({ instanceName: ctx.instanceName, jid: ctx.community.community_jid })
    } catch {
      /* remove locally regardless */
    }
  }
  await ctx.supabase.from('communities').delete().eq('id', id)
  return NextResponse.json({ success: true })
}
