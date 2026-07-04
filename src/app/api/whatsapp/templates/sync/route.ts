import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/whatsapp/templates/sync
 *
 * On the Meta backend this pulled the approved-template catalog from the
 * WhatsApp Business Account. The free Evolution backend has no such
 * catalog — templates are local snippets stored in `message_templates` —
 * so there is nothing to sync. Kept as a no-op (rather than deleted) so
 * the existing "Sync" button in the template manager degrades gracefully.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    success: true,
    synced: 0,
    message:
      'Templates are local snippets on the self-hosted backend — there is no external catalog to sync.',
  })
}
