import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findLabels } from '@/lib/whatsapp/provider/evolution'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'

// WhatsApp label colors are palette indices; map a few to hex.
const LABEL_COLORS = [
  '#64748b', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
]

/**
 * POST /api/whatsapp/labels/sync
 *
 * Pulls the WhatsApp Business labels off the connected number and
 * creates/links a CRM tag for each (keyed by whatsapp_label_id). After
 * this, labels set on the phone flow into the CRM as tags via the
 * labels.association webhook.
 */
export async function POST() {
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
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

    const instanceName = await getDefaultInstanceName(supabase, accountId)
    if (!instanceName) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    const labels = await findLabels(instanceName)
    // Skip WhatsApp's built-in system labels that aren't user pipeline tags.
    const SYSTEM = new Set([
      'Unread', 'Groups', 'Broadcast lists', 'Favorites', 'Communities',
    ])
    const userLabels = labels.filter((l) => l.name && !SYSTEM.has(l.name))

    let created = 0
    for (const label of userLabels) {
      // Already linked?
      const { data: existing } = await supabase
        .from('tags')
        .select('id')
        .eq('account_id', accountId)
        .eq('whatsapp_label_id', label.id)
        .maybeSingle()
      if (existing) continue

      const colorIdx = Number(label.color) % LABEL_COLORS.length
      await supabase.from('tags').insert({
        account_id: accountId,
        user_id: user.id,
        name: label.name,
        color: LABEL_COLORS[Number.isFinite(colorIdx) ? colorIdx : 0] ?? '#64748b',
        whatsapp_label_id: label.id,
      })
      created++
    }

    return NextResponse.json({ success: true, total: userLabels.length, created })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
