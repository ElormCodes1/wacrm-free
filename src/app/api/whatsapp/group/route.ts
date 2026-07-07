import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  createGroup,
  fetchAllGroups,
  fetchGroupInfo,
} from '@/lib/whatsapp/provider/evolution'
import { instanceForConversation } from '@/lib/whatsapp/resolve-send-target'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * GET  /api/whatsapp/group?configId=  — list every group the number is in.
 * POST /api/whatsapp/group            — create a group and surface it in the
 *   inbox. Body: { subject, participants: string[], description?, configId? }.
 */
export async function GET(request: Request) {
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

    const configId = new URL(request.url).searchParams.get('configId')
    const instanceName = await instanceForConversation(supabase, accountId, configId)
    if (!instanceName) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }
    const groups = await fetchAllGroups(instanceName, false)
    return NextResponse.json({ groups })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

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
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

    const { subject, participants, description, configId } = (await request
      .json()
      .catch(() => ({}))) as {
      subject?: string
      participants?: string[]
      description?: string
      configId?: string
    }
    if (!subject?.trim()) {
      return NextResponse.json({ error: 'A group name is required.' }, { status: 400 })
    }
    const digits = (participants ?? [])
      .map((p) => p.replace(/\D/g, ''))
      .filter(Boolean)
    if (digits.length === 0) {
      return NextResponse.json({ error: 'Add at least one participant.' }, { status: 400 })
    }

    // Resolve the number (config row) to create the group from.
    let config: { id: string; instance_name: string; user_id: string } | null = null
    if (configId) {
      const { data } = await supabase
        .from('whatsapp_config')
        .select('id, instance_name, user_id')
        .eq('id', configId)
        .eq('account_id', accountId)
        .maybeSingle()
      config = (data as typeof config) ?? null
    }
    if (!config) {
      const { data } = await supabase
        .from('whatsapp_config')
        .select('id, instance_name, user_id, connection_state, created_at')
        .eq('account_id', accountId)
        .not('instance_name', 'is', null)
        .order('created_at', { ascending: true })
      const rows = (data ?? []) as Array<{
        id: string
        instance_name: string
        user_id: string
        connection_state: string
      }>
      const chosen = rows.find((r) => r.connection_state === 'open') ?? rows[0]
      if (chosen)
        config = { id: chosen.id, instance_name: chosen.instance_name, user_id: chosen.user_id }
    }
    if (!config?.instance_name) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    // Create on WhatsApp.
    let groupJid = ''
    try {
      const res = await createGroup({
        instanceName: config.instance_name,
        subject: subject.trim(),
        participants: digits,
        description: description?.trim() || undefined,
      })
      groupJid = res.groupJid
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Create failed'
      return NextResponse.json({ error: `Group create failed: ${m}` }, { status: 502 })
    }
    if (!groupJid) {
      return NextResponse.json({ error: 'WhatsApp did not return a group id.' }, { status: 502 })
    }
    const groupId = groupJid.replace(/\D/g, '')

    // Surface it in the inbox immediately: group contact + conversation.
    // Uses the same shape the webhook would create, so a later inbound
    // message dedupes onto these rows (UNIQUE account_id+phone_normalized /
    // account_id+contact_id).
    const db = admin()
    const userId = config.user_id ?? user.id
    let contactId: string | null = null
    const { data: existing } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone', groupId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      contactId = existing.id
      await db.from('contacts').update({ name: subject.trim(), is_group: true }).eq('id', existing.id)
    } else {
      const { data: created } = await db
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          phone: groupId,
          name: subject.trim(),
          is_group: true,
        })
        .select('id')
        .maybeSingle()
      contactId = created?.id ?? null
    }

    let conversationId: string | null = null
    if (contactId) {
      const { data: existingConv } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (existingConv?.id) {
        conversationId = existingConv.id
      } else {
        const { data: conv } = await db
          .from('conversations')
          .insert({
            account_id: accountId,
            user_id: userId,
            contact_id: contactId,
            whatsapp_config_id: config.id,
            status: 'open',
          })
          .select('id')
          .maybeSingle()
        conversationId = conv?.id ?? null
      }
    }

    // Best-effort: pull the picture in later; subject is already set.
    void fetchGroupInfo(config.instance_name, groupJid).catch(() => {})

    return NextResponse.json({ success: true, groupId, groupJid, conversationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
