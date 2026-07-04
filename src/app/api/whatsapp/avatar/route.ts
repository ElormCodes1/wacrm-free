import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { syncContactAvatar } from '@/lib/whatsapp/avatar'

/**
 * POST /api/whatsapp/avatar  { contact_id }
 *
 * Re-fetches a contact's WhatsApp profile picture and re-hosts it.
 * Returns { avatar_url } (null if the contact has no public picture).
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
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { contact_id } = (await request.json().catch(() => ({}))) as {
      contact_id?: string
    }
    if (!contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, phone')
      .eq('id', contact_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const instanceName = await getDefaultInstanceName(supabase, accountId)
    if (!instanceName) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    // Storage upload needs the service role (RLS on storage.objects).
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const avatarUrl = await syncContactAvatar(admin, instanceName, contact.id, contact.phone)

    return NextResponse.json({ avatar_url: avatarUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error refreshing avatar:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
