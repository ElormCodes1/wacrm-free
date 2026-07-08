import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  updateNewsletter,
  deleteNewsletter,
  unfollowNewsletter,
} from '@/lib/whatsapp/provider/evolution'

/** Load the channel + the instance name of its number (account-scoped). */
async function loadChannel(id: string) {
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
  const { data: channel } = await supabase
    .from('channels')
    .select('*, config:whatsapp_config(instance_name)')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!channel) return { error: 'Channel not found', status: 404 as const }
  const instanceName = (channel.config as { instance_name?: string } | null)?.instance_name
  return { supabase, channel, instanceName }
}

/** PATCH { name?, description? } — rename / re-describe the channel. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await loadChannel(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { name, description } = (await request.json().catch(() => ({}))) as {
    name?: string
    description?: string
  }
  if (ctx.instanceName && ctx.channel.is_owner) {
    try {
      await updateNewsletter({
        instanceName: ctx.instanceName,
        jid: ctx.channel.newsletter_jid,
        name: name?.trim() || undefined,
        description: description?.trim(),
      })
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Update failed'
      return NextResponse.json({ error: m }, { status: 502 })
    }
  }
  const patch: Record<string, unknown> = {}
  if (name !== undefined) patch.name = name.trim()
  if (description !== undefined) patch.description = description.trim() || null
  await ctx.supabase.from('channels').update(patch).eq('id', id)
  return NextResponse.json({ success: true })
}

/** DELETE — delete the channel (owner) or unfollow it, then drop the row. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await loadChannel(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  if (ctx.instanceName) {
    try {
      if (ctx.channel.is_owner) {
        await deleteNewsletter({ instanceName: ctx.instanceName, jid: ctx.channel.newsletter_jid })
      } else {
        await unfollowNewsletter({ instanceName: ctx.instanceName, jid: ctx.channel.newsletter_jid })
      }
    } catch {
      /* remove locally regardless — WhatsApp side is best-effort */
    }
  }
  await ctx.supabase.from('channels').delete().eq('id', id)
  return NextResponse.json({ success: true })
}
