import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'
import { updateBlockStatus } from '@/lib/whatsapp/provider/evolution'

/**
 * POST /api/whatsapp/contact-block  { contact_id, block: boolean }
 *
 * Blocks/unblocks the contact on WhatsApp and records blocked_at.
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

    const { contact_id, block } = (await request.json().catch(() => ({}))) as {
      contact_id?: string
      block?: boolean
    }
    if (!contact_id || typeof block !== 'boolean') {
      return NextResponse.json({ error: 'contact_id and block required' }, { status: 400 })
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, phone')
      .eq('id', contact_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const instanceName = await getDefaultInstanceName(supabase, accountId)
    if (!instanceName) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    try {
      await updateBlockStatus({
        instanceName,
        number: contact.phone.replace(/\D/g, ''),
        block,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Block failed'
      return NextResponse.json({ error: `WhatsApp block failed: ${message}` }, { status: 502 })
    }

    await supabase
      .from('contacts')
      .update({ blocked_at: block ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', contact_id)

    return NextResponse.json({ success: true, blocked: block })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
