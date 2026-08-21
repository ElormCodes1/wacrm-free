// ============================================================
// GET/POST /api/whatsapp/health — probe every number, revive dead sockets
//
// Evolution's socket dies quietly. Twice in ninety minutes on a live
// instance, `connectionState` reported "open" while every socket operation
// failed with 428 "Connection Closed" — so inbound messages stopped, the
// CRM looked healthy, and the only symptom was silence.
//
// This probes each number for real (see isInstanceAlive), restarts any
// instance that fails, and writes the true state back to whatsapp_config
// so the rest of the app stops reading a stale column.
//
// Auth: either a signed-in member of the account (the inbox calls this on
// load and on realtime reconnect), or a cron with the WHATSAPP_HEALTH_TOKEN
// bearer token, which covers every account.
//
// Response: { checked, healed, numbers: [{ id, label, alive, healed }] }
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  isInstanceAlive,
  clearAliveCache,
  restartInstance,
  setWebhook,
} from '@/lib/whatsapp/provider/evolution'
import { appWebhookConfig } from '@/lib/whatsapp/provider/config'
import { getOperator } from '@/lib/operator/session'
import { privilegedClient } from '@/lib/supabase/privileged';

/** Give the socket a moment to come up before re-probing after a restart. */
const RESTART_SETTLE_MS = 4000

interface NumberHealth {
  id: string
  label: string | null
  instance_name: string
  alive: boolean
  healed: boolean
  /** Whether this sweep successfully re-applied the webhook settings. */
  webhookReasserted?: boolean
}

/**
 * Re-apply this app's webhook settings to an instance.
 *
 * The webhook — URL, events and the secret header — is registered once,
 * when the instance is created. Anything that changes afterwards leaves
 * the gateway posting with stale settings, and a stale SECRET is silent
 * and total: the app answers 401, Evolution treats 4xx as unrecoverable
 * and cancels retries, and every message is dropped with no row, no retry
 * and no sign in the customer's inbox that anything is missing.
 *
 * That is not hypothetical — it is what happened to a paired tenant whose
 * line read "connected" while nothing ever arrived. Re-asserting on every
 * sweep costs one call per number and makes the mismatch heal itself
 * instead of needing somebody to notice.
 */
async function reassertWebhook(instanceName: string): Promise<boolean> {
  try {
    await setWebhook({ instanceName, webhook: appWebhookConfig() })
    return true
  } catch {
    // Best effort: a gateway that will not take the webhook must not stop
    // the rest of the sweep from reporting.
    return false
  }
}

async function checkNumber(row: {
  id: string
  label: string | null
  instance_name: string
}): Promise<NumberHealth> {
  // force: a cached "alive" is precisely what a watchdog must not trust.
  const alive = await isInstanceAlive(row.instance_name, { force: true })
  if (alive) return { ...row, alive: true, healed: false }

  // Dead — restart and re-probe. A restart recovered it in testing; when
  // it doesn't, the caller sees alive:false and can escalate rather than
  // being told everything is fine.
  try {
    await restartInstance(row.instance_name)
  } catch {
    /* the re-probe below is the real verdict */
  }
  await new Promise((r) => setTimeout(r, RESTART_SETTLE_MS))
  clearAliveCache(row.instance_name)
  const revived = await isInstanceAlive(row.instance_name, { force: true })
  return { ...row, alive: revived, healed: revived }
}

async function runHealthCheck(
  rows: { id: string; label: string | null; instance_name: string }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
) {
  const results: NumberHealth[] = []
  for (const row of rows) {
    if (!row.instance_name) continue
    // Before anything else: make the gateway's webhook match ours. A dead
    // socket is visible; a stale secret is not.
    const webhookReasserted = await reassertWebhook(row.instance_name)
    const health = await checkNumber(row)
    results.push({ ...health, webhookReasserted })

    // Keep the stored column honest — it is what Settings and the older
    // code paths read, and letting it drift is how a dead line reads as
    // connected.
    await db
      .from('whatsapp_config')
      .update({
        connection_state: health.alive ? 'open' : 'close',
        status: health.alive ? 'connected' : 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', health.id)
  }
  return {
    checked: results.length,
    healed: results.filter((r) => r.healed).length,
    webhooksReasserted: results.filter((r) => r.webhookReasserted).length,
    numbers: results,
  }
}

export async function POST(request: Request) {
  return handle(request)
}

export async function GET(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  try {
    const token = process.env.WHATSAPP_HEALTH_TOKEN
    const auth = request.headers.get('authorization') ?? ''
    const isCron = Boolean(token) && auth === `Bearer ${token}`
    // An operator can run the same platform-wide sweep. Without this,
    // repairing a tenant's gateway meant knowing a cron token that lives
    // only in the deployment's environment.
    const isOperator = !isCron && Boolean(await getOperator())

    if (isCron || isOperator) {
      // Service role: a cron has no session, and this sweeps every account.
      const admin = privilegedClient('system-maintenance')
      const { data: rows } = await admin
        .from('whatsapp_config')
        .select('id, label, instance_name')
      return NextResponse.json(await runHealthCheck(rows ?? [], admin))
    }

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
      return NextResponse.json({ checked: 0, healed: 0, numbers: [] })
    }

    const { data: rows } = await supabase
      .from('whatsapp_config')
      .select('id, label, instance_name')
      .eq('account_id', accountId)
    return NextResponse.json(await runHealthCheck(rows ?? [], supabase))
  } catch (error) {
    console.error('Error in /api/whatsapp/health:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
