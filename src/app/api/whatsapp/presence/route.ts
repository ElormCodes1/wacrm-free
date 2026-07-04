import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPresence, type EvolutionPresence } from '@/lib/whatsapp/provider/evolution'
import { resolveSendTarget } from '@/lib/whatsapp/resolve-send-target'

const VALID: EvolutionPresence[] = [
  'composing',
  'recording',
  'paused',
  'available',
  'unavailable',
]

/**
 * POST /api/whatsapp/presence  { conversation_id, presence }
 *
 * Sends a presence update (e.g. "composing" → the customer sees
 * "typing…") to the conversation. Best-effort — returns 200 even if the
 * presence send fails, since it's a cosmetic signal.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      conversation_id?: string
      presence?: EvolutionPresence
    }
    const presence = body.presence ?? 'composing'
    if (!body.conversation_id || !VALID.includes(presence)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    }

    const target = await resolveSendTarget(supabase, accountId, body.conversation_id)
    if (!target) return NextResponse.json({ ok: false }, { status: 200 })

    try {
      await sendPresence({
        instanceName: target.instanceName,
        to: target.toDigits,
        presence,
        delayMs: presence === 'composing' || presence === 'recording' ? 3000 : 500,
      })
    } catch {
      // cosmetic — swallow
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
