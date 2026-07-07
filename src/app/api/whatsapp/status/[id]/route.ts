import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { deleteMessageForEveryone } from '@/lib/whatsapp/provider/evolution'
import { instanceForConversation } from '@/lib/whatsapp/resolve-send-target'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * DELETE /api/whatsapp/status/{id}
 *
 * Delete one of our own posted statuses ({id} = status_updates.id). A status
 * is a message to `status@broadcast`, so we revoke it with the same
 * delete-for-everyone call used for unsend, then drop the local rows.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
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

    const { data: status } = await supabase
      .from('status_updates')
      .select('id, is_mine, message_id, whatsapp_config_id, account_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!status) return NextResponse.json({ error: 'Status not found' }, { status: 404 })
    if (!status.is_mine) {
      return NextResponse.json({ error: 'You can only delete your own status.' }, { status: 403 })
    }

    // Revoke on WhatsApp (best-effort — still clean up locally either way).
    const instanceName = await instanceForConversation(
      supabase,
      accountId,
      (status.whatsapp_config_id as string | null) ?? null,
    )
    if (instanceName && status.message_id) {
      try {
        await deleteMessageForEveryone({
          instanceName,
          remoteJid: 'status@broadcast',
          fromMe: true,
          id: status.message_id as string,
        })
      } catch {
        /* fall through to local cleanup */
      }
    }

    // Drop the local rows (status + any recorded viewers).
    const db = admin()
    await db.from('status_updates').delete().eq('id', id).eq('account_id', accountId)
    if (status.message_id) {
      await db
        .from('status_views')
        .delete()
        .eq('account_id', accountId)
        .eq('message_id', status.message_id as string)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
