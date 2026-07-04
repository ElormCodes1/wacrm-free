import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'
import {
  updateProfileName,
  updateProfileStatus,
} from '@/lib/whatsapp/provider/evolution'

/**
 * POST /api/whatsapp/profile  { name?, status? }
 *
 * Updates the connected number's own WhatsApp display name and/or "about"
 * status text.
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

    const { name, status } = (await request.json().catch(() => ({}))) as {
      name?: string
      status?: string
    }
    if (name === undefined && status === undefined) {
      return NextResponse.json({ error: 'Provide name and/or status' }, { status: 400 })
    }

    const instanceName = await getDefaultInstanceName(supabase, accountId)
    if (!instanceName) {
      return NextResponse.json({ error: 'WhatsApp not connected.' }, { status: 400 })
    }

    try {
      if (name !== undefined && name.trim()) {
        await updateProfileName({ instanceName, name: name.trim() })
      }
      if (status !== undefined) {
        await updateProfileStatus({ instanceName, status })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Update failed'
      return NextResponse.json({ error: `WhatsApp update failed: ${message}` }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
