// ============================================================
// POST /api/whatsapp/reconcile — ingest messages the gateway kept but never delivered
//
// This exists because of a specific upstream behaviour, not as a general
// safety net. Evolution's history sync skips any message already present
// in its OWN database:
//
//   if (messagesRepository?.has(m.key.id)) continue;   // baileys.service
//
// where messagesRepository is every message id it has stored. The
// assumption is "stored ⇒ delivered", which is false whenever a webhook
// delivery failed — the app was restarting, the socket died between the
// save and the emit, the payload was rejected. Once a message is stored
// but undelivered it can never be delivered: the next history sync skips
// it, and there is no retry. It simply sits in the gateway forever,
// looking perfectly healthy, while the inbox has never seen it.
//
// Delivery is therefore at-most-once with no acknowledgement. Reconciling
// against the source of truth is the standard answer to that, and the
// only one available without patching the gateway.
//
// Recovered messages are replayed through the app's own webhook as
// `messages.set` — the backlog event — so they take the identical code
// path as any other message and inherit its dedupe. Re-running the sweep
// is a no-op.
//
// Auth: a signed-in member, or the WHATSAPP_HEALTH_TOKEN bearer (cron).
// Body: { pages?: number }  — how many 50-message pages back to scan.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { findMessagesPage } from '@/lib/whatsapp/provider/evolution'

/** Pages of 50, newest first. Four covers a couple of hours on a busy line. */
const DEFAULT_PAGES = 4
const MAX_PAGES = 40

interface Row {
  id: string
  label: string | null
  instance_name: string
}

async function reconcileNumber(
  row: Row,
  pages: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  origin: string,
): Promise<{ label: string | null; scanned: number; missing: number; recovered: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seen: any[] = []
  for (let page = 1; page <= pages; page++) {
    const records = await findMessagesPage({
      instanceName: row.instance_name,
      page,
      offset: 50,
    })
    if (!records.length) break
    seen.push(...records)
  }

  const ids = seen.map((m) => m?.key?.id).filter(Boolean) as string[]
  if (!ids.length) {
    return { label: row.label, scanned: 0, missing: 0, recovered: 0 }
  }

  // Which of these does the CRM already hold? Chunked — `in.(…)` goes into
  // the URL, and a few hundred ids would overflow it.
  const known = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data } = await db
      .from('messages')
      .select('message_id')
      .in('message_id', chunk)
    for (const m of data ?? []) known.add(m.message_id)
  }
  // Parked messages aren't lost — they're waiting on a LID. Replaying them
  // would only park them again.
  const { data: parked } = await db.from('pending_lid_events').select('message_id')
  for (const p of parked ?? []) known.add(p.message_id)

  const missing = seen.filter((m) => m?.key?.id && !known.has(m.key.id))
  let recovered = 0
  for (const message of missing) {
    try {
      const res = await fetch(`${origin}/api/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EVOLUTION_WEBHOOK_SECRET
            ? { 'x-evolution-secret': process.env.EVOLUTION_WEBHOOK_SECRET }
            : {}),
        },
        body: JSON.stringify({
          // messages.set, not messages.upsert: this IS backlog, and that
          // path already dedupes by message id before inserting.
          event: 'messages.set',
          instance: row.instance_name,
          data: message,
        }),
      })
      if (res.ok) recovered += 1
    } catch (err) {
      console.error('[reconcile] replay failed:', err instanceof Error ? err.message : err)
    }
  }

  return { label: row.label, scanned: ids.length, missing: missing.length, recovered }
}

async function handle(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { pages?: number }
    const pages = Math.min(Math.max(1, Number(body.pages) || DEFAULT_PAGES), MAX_PAGES)
    const origin = new URL(request.url).origin

    const token = process.env.WHATSAPP_HEALTH_TOKEN
    const auth = request.headers.get('authorization') ?? ''
    const isCron = Boolean(token) && auth === `Bearer ${token}`

    let rows: Row[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let db: any

    if (isCron) {
      db = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      const { data } = await db.from('whatsapp_config').select('id, label, instance_name')
      rows = data ?? []
    } else {
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
      if (!accountId) return NextResponse.json({ numbers: [] })
      db = supabase
      const { data } = await supabase
        .from('whatsapp_config')
        .select('id, label, instance_name')
        .eq('account_id', accountId)
      rows = data ?? []
    }

    const numbers = []
    for (const row of rows) {
      if (!row.instance_name) continue
      numbers.push(await reconcileNumber(row, pages, db, origin))
    }
    return NextResponse.json({
      pages,
      recovered: numbers.reduce((n, r) => n + r.recovered, 0),
      numbers,
    })
  } catch (error) {
    console.error('Error in /api/whatsapp/reconcile:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return handle(request)
}
