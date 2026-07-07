import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchGroupInviteCode,
  revokeGroupInviteCode,
} from '@/lib/whatsapp/provider/evolution'
import { instanceForGroup, groupJidFromId } from '@/lib/whatsapp/resolve-group'

async function resolve(request: Request, groupId: string) {
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
  const instanceName = await instanceForGroup(supabase, accountId, groupId, configId)
  if (!instanceName) return { error: 'WhatsApp not connected.', status: 400 as const }
  return { instanceName }
}

/** GET /api/whatsapp/group/{groupId}/invite — current invite link. */
export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params
    const r = await resolve(request, groupId)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
    const invite = await fetchGroupInviteCode(r.instanceName, groupJidFromId(groupId))
    if (!invite) return NextResponse.json({ error: 'Could not fetch invite' }, { status: 502 })
    return NextResponse.json({ invite })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Internal server error'
    return NextResponse.json({ error: m }, { status: 500 })
  }
}

/** POST /api/whatsapp/group/{groupId}/invite — revoke + regenerate the link. */
export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params
    const r = await resolve(request, groupId)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
    const invite = await revokeGroupInviteCode(r.instanceName, groupJidFromId(groupId))
    if (!invite) return NextResponse.json({ error: 'Could not revoke invite' }, { status: 502 })
    return NextResponse.json({ invite })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Internal server error'
    return NextResponse.json({ error: m }, { status: 500 })
  }
}
