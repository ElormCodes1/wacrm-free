// ============================================================
// POST /api/whatsapp/contacts/refresh-names — put names to the numbers
//
// Contacts are created from inbound messages, and WhatsApp supplies a
// pushName only when the sender has set one and the event carries it.
// When it does not, the creation path writes the phone number into
// `name`. In production that is the normal case, not the exception: 349
// contacts, every one of them "named", and 283 of those names were just
// digits — one account had 234 of 236.
//
// The inbox therefore reads as a list of phone numbers, while the phone
// those messages came from knows perfectly well who these people are.
// This reconciles the two: for every contact whose stored name carries no
// more information than its digits, take the name from the linked
// phone's address book.
//
// Only placeholders are touched. A name somebody typed into the CRM is
// never overwritten by WhatsApp's idea of who this is — see betterName.
//
// Auth: a signed-in member of the account.
// ============================================================

import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { findContacts, jidToPhone } from '@/lib/whatsapp/provider/evolution'
import { betterName } from '@/lib/whatsapp/contact-name'

export async function POST() {
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

    const { data: lines } = await supabase
      .from('whatsapp_config')
      .select('instance_name')
      .eq('account_id', accountId)

    // Every linked number's address book, merged. A business with two
    // lines knows a name if EITHER phone knows it, and which one is an
    // accident of who happened to message which number.
    const directory = new Map<string, string>()
    for (const line of lines ?? []) {
      if (!line.instance_name) continue
      for (const entry of await findContacts(line.instance_name)) {
        const jid: unknown = entry?.remoteJid ?? entry?.id
        if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) continue
        const phone = (jidToPhone(jid) ?? '').replace(/\D/g, '')
        if (!phone) continue
        // Address-book name first: what the owner saved them as, rather
        // than what they currently call themselves.
        const name =
          (typeof entry?.name === 'string' && entry.name.trim()) ||
          (typeof entry?.pushName === 'string' && entry.pushName.trim()) ||
          (typeof entry?.verifiedName === 'string' && entry.verifiedName.trim()) ||
          ''
        if (name && !directory.has(phone)) directory.set(phone, name)
      }
    }

    if (directory.size === 0) {
      return NextResponse.json({ updated: 0, scanned: 0, reason: 'empty-directory' })
    }

    // Groups are excluded: a group's name comes from its subject, which is
    // fetched separately, and its "phone" is a group id no address book
    // will ever match.
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, name, phone, phone_normalized')
      .eq('account_id', accountId)
      .or('is_group.is.null,is_group.eq.false')

    let updated = 0
    for (const contact of contacts ?? []) {
      const key = (contact.phone_normalized ?? contact.phone ?? '').replace(/\D/g, '')
      const candidate = key ? directory.get(key) : undefined
      if (!candidate) continue

      const improved = betterName(contact.name, candidate, contact.phone)
      if (!improved) continue

      const { error } = await supabase
        .from('contacts')
        .update({ name: improved, updated_at: new Date().toISOString() })
        .eq('id', contact.id)
      if (!error) updated += 1
    }

    return NextResponse.json({
      updated,
      scanned: contacts?.length ?? 0,
      knownNames: directory.size,
    })
  } catch (error) {
    console.error('Error in /api/whatsapp/contacts/refresh-names:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
