import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  communityLinkedGroups,
  linkGroupToCommunity,
  unlinkGroupFromCommunity,
} from '@/lib/whatsapp/provider/evolution'

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
    .select('community_jid, config:whatsapp_config(instance_name)')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!community) return { error: 'Community not found', status: 404 as const }
  const instanceName = (community.config as { instance_name?: string } | null)?.instance_name
  if (!instanceName) return { error: 'WhatsApp not connected', status: 400 as const }
  return { jid: community.community_jid as string, instanceName }
}

/** GET — the community's linked groups. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await loadCommunity(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  try {
    const groups = await communityLinkedGroups({ instanceName: ctx.instanceName, jid: ctx.jid })
    return NextResponse.json({ groups })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to fetch linked groups'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}

/** POST { groupJid } — link an existing group into the community. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await loadCommunity(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { groupJid } = (await request.json().catch(() => ({}))) as { groupJid?: string }
  if (!groupJid) return NextResponse.json({ error: 'groupJid required' }, { status: 400 })
  try {
    await linkGroupToCommunity({ instanceName: ctx.instanceName, communityJid: ctx.jid, groupJid })
    return NextResponse.json({ success: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to link group'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}

/** DELETE { groupJid } — unlink a group from the community. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const ctx = await loadCommunity(id)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { groupJid } = (await request.json().catch(() => ({}))) as { groupJid?: string }
  if (!groupJid) return NextResponse.json({ error: 'groupJid required' }, { status: 400 })
  try {
    await unlinkGroupFromCommunity({ instanceName: ctx.instanceName, communityJid: ctx.jid, groupJid })
    return NextResponse.json({ success: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to unlink group'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}
