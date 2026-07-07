import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchGroupDetail,
  updateGroupSubject,
  updateGroupDescription,
  updateGroupSetting,
  leaveGroup,
  type GroupSettingAction,
} from '@/lib/whatsapp/provider/evolution'
import { instanceForGroup, groupJidFromId } from '@/lib/whatsapp/resolve-group'

const SETTINGS: GroupSettingAction[] = [
  'announcement',
  'not_announcement',
  'locked',
  'unlocked',
]

async function ctx(request: Request) {
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
  const configId = new URL(request.url).searchParams.get('configId')
  return { supabase, accountId, configId }
}

/** GET /api/whatsapp/group/{groupId}?configId= — full group detail. */
export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params
    const c = await ctx(request)
    if ('error' in c) return NextResponse.json({ error: c.error }, { status: c.status })
    const instanceName = await instanceForGroup(c.supabase, c.accountId, groupId, c.configId)
    if (!instanceName)
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    const group = await fetchGroupDetail(instanceName, groupJidFromId(groupId))
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    // Auto-heal the CRM group name from the live subject (WhatsApp is the
    // source of truth) so the inbox never shows the raw group id.
    if (group.subject?.trim()) {
      await c.supabase
        .from('contacts')
        .update({ name: group.subject.trim(), updated_at: new Date().toISOString() })
        .eq('account_id', c.accountId)
        .eq('is_group', true)
        .eq('phone', groupId.replace(/\D/g, ''))
        .neq('name', group.subject.trim())
    }
    return NextResponse.json({ group })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Internal server error'
    return NextResponse.json({ error: m }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/group/{groupId} — update group.
 *   { subject?, description?, setting? }  (setting = announcement | ... )
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params
    const c = await ctx(request)
    if ('error' in c) return NextResponse.json({ error: c.error }, { status: c.status })
    const body = (await request.json().catch(() => ({}))) as {
      subject?: string
      description?: string
      setting?: string
    }
    const instanceName = await instanceForGroup(c.supabase, c.accountId, groupId, c.configId)
    if (!instanceName)
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    const jid = groupJidFromId(groupId)

    if (typeof body.subject === 'string' && body.subject.trim()) {
      await updateGroupSubject(instanceName, jid, body.subject.trim())
      // Keep the CRM group contact name in sync.
      await c.supabase
        .from('contacts')
        .update({ name: body.subject.trim(), updated_at: new Date().toISOString() })
        .eq('account_id', c.accountId)
        .eq('is_group', true)
        .eq('phone', groupId.replace(/\D/g, ''))
    }
    if (typeof body.description === 'string') {
      await updateGroupDescription(instanceName, jid, body.description)
    }
    if (body.setting && SETTINGS.includes(body.setting as GroupSettingAction)) {
      await updateGroupSetting(instanceName, jid, body.setting as GroupSettingAction)
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Update failed'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}

/** DELETE /api/whatsapp/group/{groupId} — leave the group + archive it. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params
    const c = await ctx(request)
    if ('error' in c) return NextResponse.json({ error: c.error }, { status: c.status })
    const instanceName = await instanceForGroup(c.supabase, c.accountId, groupId, c.configId)
    if (!instanceName)
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    await leaveGroup(instanceName, groupJidFromId(groupId))
    // Archive the CRM conversation so it drops out of the active inbox.
    await c.supabase
      .from('conversations')
      .update({ archived_at: new Date().toISOString() })
      .eq('account_id', c.accountId)
      .in(
        'contact_id',
        (
          await c.supabase
            .from('contacts')
            .select('id')
            .eq('account_id', c.accountId)
            .eq('is_group', true)
            .eq('phone', groupId.replace(/\D/g, ''))
        ).data?.map((r) => r.id) ?? [],
      )
    return NextResponse.json({ success: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Leave failed'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}
