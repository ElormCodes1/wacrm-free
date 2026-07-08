import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchGroupPendingParticipants,
  updateGroupPendingParticipants,
} from '@/lib/whatsapp/provider/evolution'
import { instanceForGroup, groupJidFromId } from '@/lib/whatsapp/resolve-group'

/**
 * Group join-request approvals (admin-approval groups).
 *
 *   GET  /api/whatsapp/group/{groupId}/requests?configId=
 *        → { requests: [{ jid, phone }] } pending members.
 *   POST /api/whatsapp/group/{groupId}/requests
 *        { action: 'approve'|'reject', jids: string[], configId? }
 *
 * Backed by our patched Evolution /group/pendingParticipants +
 * /group/updatePendingParticipant (Baileys groupRequest*). WhatsApp
 * enforces admin rights server-side; the UI only surfaces this for
 * groups the connected number owns.
 */
async function resolveAccount(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized' as const, status: 401 }
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return { error: 'No account' as const, status: 403 }
  return { accountId }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params
    const supabase = await createClient()
    const acc = await resolveAccount(supabase)
    if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })

    const configId = new URL(request.url).searchParams.get('configId') ?? undefined
    const instanceName = await instanceForGroup(supabase, acc.accountId, groupId, configId)
    if (!instanceName)
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })

    const requests = await fetchGroupPendingParticipants(instanceName, groupJidFromId(groupId))
    return NextResponse.json({ requests })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Failed to load join requests'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params
    const supabase = await createClient()
    const acc = await resolveAccount(supabase)
    if ('error' in acc) return NextResponse.json({ error: acc.error }, { status: acc.status })

    const { action, jids, configId } = (await request.json().catch(() => ({}))) as {
      action?: string
      jids?: string[]
      configId?: string
    }
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
    const cleanJids = (jids ?? []).map((j) => String(j).trim()).filter(Boolean)
    if (cleanJids.length === 0) {
      return NextResponse.json({ error: 'No requesters supplied' }, { status: 400 })
    }

    const instanceName = await instanceForGroup(supabase, acc.accountId, groupId, configId)
    if (!instanceName)
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })

    await updateGroupPendingParticipants(
      instanceName,
      groupJidFromId(groupId),
      action,
      cleanJids,
    )
    return NextResponse.json({ success: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Join-request update failed'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}
