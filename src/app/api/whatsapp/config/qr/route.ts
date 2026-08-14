import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  connectInstance,
  isInstanceAlive,
  clearAliveCache,
  restartInstance,
  logoutInstance,
} from '@/lib/whatsapp/provider/evolution'

/**
 * GET /api/whatsapp/config/qr?number_id=<id>
 *
 * Returns a fresh QR (or the current state) for one number. The Settings
 * UI polls this while a QR is being scanned.
 *   { state: 'open' }                      — linked, stop polling
 *   { state: 'connecting', qrcode: {...} } — show/refresh the QR
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
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const numberId = new URL(request.url).searchParams.get('number_id')
    if (!numberId) {
      return NextResponse.json({ error: 'number_id is required' }, { status: 400 })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('instance_name')
      .eq('id', numberId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!config?.instance_name) {
      return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    }

    // Probe rather than trust getConnectionState. It reports the gateway's
    // belief, which stays "open" through a dead socket — so this route used
    // to answer "already connected", write `connected` back over the honest
    // state, and refuse to issue a QR. The one screen for fixing a dead
    // line was the one screen that insisted nothing was wrong.
    const alive = await isInstanceAlive(config.instance_name, { force: true })
    if (alive) {
      await supabase
        .from('whatsapp_config')
        .update({
          connection_state: 'open',
          status: 'connected',
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', numberId)
      return NextResponse.json({ state: 'open' })
    }

    // Not alive. Record that before anything else, so the UI stops showing
    // a dead line as connected even if the reconnect below fails.
    await supabase
      .from('whatsapp_config')
      .update({
        connection_state: 'close',
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', numberId)

    // Evolution won't emit a QR while it still believes it's connected, so
    // clear that belief first: restart the socket, and log out if it comes
    // back still claiming to be open. Both are best-effort — the connect
    // call below is the thing that has to succeed.
    try {
      await restartInstance(config.instance_name)
      clearAliveCache(config.instance_name)
      await new Promise((r) => setTimeout(r, 3000))
      if (!(await isInstanceAlive(config.instance_name, { force: true }))) {
        try {
          await logoutInstance(config.instance_name)
        } catch {
          /* a dead socket can't deliver a logout; the connect still may work */
        }
      }
    } catch {
      /* fall through to connect */
    }

    const qrcode = await connectInstance({ instanceName: config.instance_name })
    return NextResponse.json({
      state: 'close',
      qrcode: {
        base64: qrcode.base64 ?? null,
        code: qrcode.code ?? null,
        pairingCode: qrcode.pairingCode ?? null,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error in WhatsApp config QR:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
