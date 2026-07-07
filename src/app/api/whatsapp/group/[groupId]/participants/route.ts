import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  updateGroupParticipants,
  type GroupParticipantAction,
} from '@/lib/whatsapp/provider/evolution'
import { instanceForGroup, groupJidFromId } from '@/lib/whatsapp/resolve-group'

const ACTIONS: GroupParticipantAction[] = ['add', 'remove', 'promote', 'demote']

/**
 * POST /api/whatsapp/group/{groupId}/participants
 *   { action: 'add'|'remove'|'promote'|'demote', participants: string[], configId? }
 * participants = E.164 digits (Evolution resolves phone→member internally).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params
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

    const { action, participants, configId } = (await request.json().catch(() => ({}))) as {
      action?: string
      participants?: string[]
      configId?: string
    }
    if (!action || !ACTIONS.includes(action as GroupParticipantAction)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
    const digits = (participants ?? []).map((p) => p.replace(/\D/g, '')).filter(Boolean)
    if (digits.length === 0) {
      return NextResponse.json({ error: 'No participants supplied' }, { status: 400 })
    }

    const instanceName = await instanceForGroup(supabase, accountId, groupId, configId)
    if (!instanceName)
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })

    await updateGroupParticipants(
      instanceName,
      groupJidFromId(groupId),
      action as GroupParticipantAction,
      digits,
    )
    return NextResponse.json({ success: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'Participant update failed'
    return NextResponse.json({ error: m }, { status: 502 })
  }
}
