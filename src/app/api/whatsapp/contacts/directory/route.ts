// ============================================================
// GET /api/whatsapp/contacts/directory — the linked phone's address book
//
// The inbox can only ever offer people who have already messaged in,
// because that is the only way a contact row gets created. So starting a
// conversation with someone — the ordinary thing a business does all day
// — was impossible from inside the CRM.
//
// The gateway already knows the address book of the linked phone. This
// reads it live and returns it for the picker.
//
// Read-only on purpose: nothing here is written to the contacts table.
// A phone's address book runs to thousands of entries, and importing all
// of them would fill the CRM with rows for people the business will never
// message — the same hoarding the history cap exists to prevent. A
// contact becomes real when somebody actually picks it (see ./start).
//
// Auth: a signed-in member of the account.
// ============================================================

import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { findContacts, jidToPhone } from '@/lib/whatsapp/provider/evolution'

/**
 * Enough to scroll and search, not so many that the response is a burden.
 * The picker searches within what it is given, so this is a ceiling on an
 * unusually large address book rather than a normal case.
 */
const MAX_ENTRIES = 1000

export interface DirectoryEntry {
  /** Digits only — what the picker sends to ./start. */
  phone: string
  /** The name the phone's owner has for them, when there is one. */
  name: string | null
}

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
      return NextResponse.json({ contacts: [] })
    }

    // Which number's address book. Defaults to the account's first
    // connected line, so the picker works without the caller having to
    // know about instances.
    const numberId = new URL(request.url).searchParams.get('number_id')
    let query = supabase
      .from('whatsapp_config')
      .select('id, instance_name, connection_state')
      .eq('account_id', accountId)
    if (numberId) query = query.eq('id', numberId)
    const { data: rows } = await query

    const line =
      (rows ?? []).find((r) => r.connection_state === 'open') ?? (rows ?? [])[0]
    if (!line?.instance_name) {
      return NextResponse.json({ contacts: [], reason: 'no-number' })
    }

    const raw = await findContacts(line.instance_name)

    // Dedupe by phone. The gateway can return the same person more than
    // once (different jid forms), and a picker that lists someone twice
    // looks broken in a way that makes people distrust the whole list.
    const byPhone = new Map<string, DirectoryEntry>()
    for (const entry of raw) {
      const jid: string | undefined = entry?.remoteJid ?? entry?.id
      if (typeof jid !== 'string') continue
      // Groups, broadcasts and LID-only entries are not people you can
      // start a 1:1 chat with by number.
      if (!jid.endsWith('@s.whatsapp.net')) continue

      const phone = (jidToPhone(jid) ?? '').replace(/\D/g, '')
      if (!phone) continue

      const name: string | null =
        (typeof entry?.pushName === 'string' && entry.pushName.trim()) ||
        (typeof entry?.name === 'string' && entry.name.trim()) ||
        null

      const existing = byPhone.get(phone)
      // Prefer the entry that actually has a name — otherwise a nameless
      // duplicate can overwrite a named one and the person becomes a bare
      // number in the list.
      if (!existing || (!existing.name && name)) {
        byPhone.set(phone, { phone, name })
      }
      if (byPhone.size >= MAX_ENTRIES) break
    }

    const contacts = [...byPhone.values()].sort((a, b) => {
      // Named first, then alphabetical. A wall of bare numbers at the top
      // is not a usable address book.
      if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1
      return (a.name ?? a.phone).localeCompare(b.name ?? b.phone)
    })

    return NextResponse.json({ contacts })
  } catch (error) {
    console.error('Error in /api/whatsapp/contacts/directory:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
