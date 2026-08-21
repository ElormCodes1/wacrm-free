import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import {
  createInstance,
  isInstanceAlive,
  fetchInstance,
  logoutInstance,
  deleteInstance,
  jidToPhone,
  type EvolutionQr,
} from '@/lib/whatsapp/provider/evolution'
import { appWebhookConfig, invalidateInstanceConfig } from '@/lib/whatsapp/provider/config'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.account_id as string) ?? null
}

function statusFor(state: string): 'connected' | 'disconnected' {
  return state === 'open' ? 'connected' : 'disconnected'
}

/**
 * GET /api/whatsapp/config
 *
 * Lists this account's WhatsApp numbers with live state, and reports
 * `connected: true` if ANY number is open (used by the settings overview).
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ connected: false, numbers: [] }, { status: 200 })
    }

    const { data: rows } = await supabase
      .from('whatsapp_config')
      .select('id, label, instance_name, connection_state, phone_number_id, connected_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })

    // Every number is checked AT ONCE. Done one at a time, a gateway
    // having a bad day cost one timeout per number — so the page got
    // slower the more numbers a customer had, which is backwards.
    const numbers = await Promise.all(
      (rows ?? []).map(async (row) => {
        let state = row.connection_state ?? 'close'
        let phone: string | null = null
        let name: string | null = null

        // A number that has never paired has no WhatsApp socket to answer
        // a probe, so asking can only wait for the timeout. That is the
        // state EVERY number is in on the QR screen, which is how this
        // hung the one page where it mattered.
        const everPaired = Boolean(row.connected_at) || row.connection_state === 'open'

        if (row.instance_name && everPaired) {
          try {
            // getConnectionState reports the gateway's *belief*, which stays
            // "open" through a dead socket — the failure that made a
            // disconnected line look healthy. Probe it, then report.
            const alive = await isInstanceAlive(row.instance_name)
            state = alive ? 'open' : 'close'
            const info = await fetchInstance(row.instance_name)
            phone = info?.ownerJid ? jidToPhone(info.ownerJid) : null
            name = info?.profileName ?? null
            if (state !== row.connection_state) {
              await supabase
                .from('whatsapp_config')
                .update({
                  connection_state: state,
                  status: statusFor(state),
                  connected_at: state === 'open' ? new Date().toISOString() : null,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', row.id)
            }
          } catch {
            /* keep stored state — a gateway that will not answer must not
               stop the page from rendering */
          }
        }

        return {
          id: row.id,
          label: row.label,
          connection_state: state,
          phone_info:
            state === 'open' ? { display_phone_number: phone, verified_name: name } : null,
        }
      }),
    )

    const anyConnected = numbers.some((n) => n.connection_state === 'open')

    return NextResponse.json({ connected: anyConnected, numbers })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json({ connected: false, numbers: [] }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/config  { label? }
 *
 * Adds a NEW WhatsApp number: creates a fresh Evolution instance + webhook
 * and returns a QR to scan. Each call adds another number.
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
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const label: string | null =
      typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : null

    const instanceName = `wacrm-${randomUUID()}`
    const webhook = appWebhookConfig()

    let qrcode: EvolutionQr | undefined
    let instanceId: string | undefined
    try {
      const created = await createInstance({ instanceName, webhook })
      qrcode = created.qrcode
      instanceId = created.instance.instanceId
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Failed to create number: ${message}` }, { status: 502 })
    }

    const { data: row, error: insErr } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: user.id,
        instance_name: instanceName,
        instance_id: instanceId ?? null,
        connection_state: 'connecting',
        status: 'disconnected',
        label,
      })
      .select('id')
      .single()
    if (insErr || !row) {
      // Roll back the Evolution instance if we couldn't persist.
      try {
        await deleteInstance(instanceName)
      } catch {
        /* ignore */
      }
      return NextResponse.json({ error: 'Failed to save number' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      number_id: row.id,
      qrcode: qrcode
        ? {
            base64: qrcode.base64 ?? null,
            code: qrcode.code ?? null,
            pairingCode: qrcode.pairingCode ?? null,
          }
        : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('Error in WhatsApp config POST:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/config  { number_id, label }
 *
 * Renames one WhatsApp number.
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const { number_id, label } = (await request.json().catch(() => ({}))) as {
      number_id?: string
      label?: string
    }
    if (!number_id) {
      return NextResponse.json({ error: 'number_id is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('whatsapp_config')
      .update({ label: label?.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', number_id)
      .eq('account_id', accountId)
    if (error) {
      return NextResponse.json({ error: 'Failed to rename' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config  { number_id }
 *
 * Removes one WhatsApp number (logs it out, deletes the instance + row).
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const { number_id } = (await request.json().catch(() => ({}))) as { number_id?: string }
    if (!number_id) {
      return NextResponse.json({ error: 'number_id is required' }, { status: 400 })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('id, instance_name')
      .eq('id', number_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!config) {
      return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    }

    if (config.instance_name) {
      try {
        await logoutInstance(config.instance_name)
      } catch {
        /* non-fatal */
      }
      try {
        await deleteInstance(config.instance_name)
      } catch {
        /* non-fatal */
      }
    }

    await supabase.from('whatsapp_config').delete().eq('id', config.id)
    // The webhook route memoises instance → account; drop this one now so
    // any event still in flight can't resolve to the row we just deleted.
    if (config.instance_name) invalidateInstanceConfig(config.instance_name)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
