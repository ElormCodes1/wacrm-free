import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getInstanceSettings,
  setInstanceSettings,
  type InstanceSettings,
} from '@/lib/whatsapp/provider/evolution'
import { getDefaultInstanceName } from '@/lib/whatsapp/resolve-send-target'

async function resolve(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return { error: 'No account', status: 403 as const }
  const instanceName = await getDefaultInstanceName(supabase, accountId)
  if (!instanceName) return { error: 'WhatsApp not connected.', status: 400 as const }
  return { instanceName }
}

/** GET current instance settings. */
export async function GET() {
  const supabase = await createClient()
  const ctx = await resolve(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const settings = await getInstanceSettings(ctx.instanceName)
  return NextResponse.json({ settings: settings ?? {} })
}

/** POST to update instance settings (reject-call, auto-read, sync-history…). */
export async function POST(request: Request) {
  const supabase = await createClient()
  const ctx = await resolve(supabase)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body = (await request.json().catch(() => ({}))) as InstanceSettings
  // Whitelist the settings we expose.
  const settings: InstanceSettings = {}
  if (typeof body.rejectCall === 'boolean') settings.rejectCall = body.rejectCall
  if (typeof body.msgCall === 'string') settings.msgCall = body.msgCall
  if (typeof body.readMessages === 'boolean') settings.readMessages = body.readMessages
  if (typeof body.alwaysOnline === 'boolean') settings.alwaysOnline = body.alwaysOnline
  if (typeof body.syncFullHistory === 'boolean') settings.syncFullHistory = body.syncFullHistory
  if (typeof body.groupsIgnore === 'boolean') settings.groupsIgnore = body.groupsIgnore

  try {
    await setInstanceSettings({ instanceName: ctx.instanceName, settings })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
  return NextResponse.json({ success: true })
}
