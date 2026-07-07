import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * POST /api/whatsapp/conversation/start  { phone, name? }
 *
 * Find-or-create a 1:1 contact + conversation for a phone number (e.g.
 * clicking a group member) and return its conversationId so the caller can
 * deep-link to it (/inbox?c=<id>). Mirrors the webhook's find-or-create
 * shape so a later inbound message dedupes onto the same rows.
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
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

    const { phone, name } = (await request.json().catch(() => ({}))) as {
      phone?: string
      name?: string
    }
    const digits = (phone ?? '').replace(/\D/g, '')
    if (!digits) return NextResponse.json({ error: 'A phone number is required.' }, { status: 400 })

    // Default number (config) to tag the conversation with.
    const { data: cfgRows } = await supabase
      .from('whatsapp_config')
      .select('id, user_id, connection_state, created_at')
      .eq('account_id', accountId)
      .not('instance_name', 'is', null)
      .order('created_at', { ascending: true })
    const rows = (cfgRows ?? []) as Array<{
      id: string
      user_id: string
      connection_state: string
    }>
    const config = rows.find((r) => r.connection_state === 'open') ?? rows[0] ?? null
    const userId = config?.user_id ?? user.id

    const db = admin()

    // Find-or-create the contact.
    let contactId: string | null = null
    const { data: existing } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone_normalized', digits)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      contactId = existing.id
    } else {
      const { data: created } = await db
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          phone: digits,
          name: name?.trim() || digits,
          is_group: false,
        })
        .select('id')
        .maybeSingle()
      contactId = created?.id ?? null
    }
    if (!contactId) return NextResponse.json({ error: 'Could not create contact' }, { status: 500 })

    // Find-or-create the conversation.
    let conversationId: string | null = null
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
          whatsapp_config_id: config?.id ?? null,
          status: 'open',
        })
        .select('id')
        .maybeSingle()
      conversationId = conv?.id ?? null
    }
    if (!conversationId) return NextResponse.json({ error: 'Could not open conversation' }, { status: 500 })

    return NextResponse.json({ conversationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
