// ============================================================
// POST /api/whatsapp/contacts/start — open a thread with someone new
//
// The other half of the picker (see ../directory). The directory is read
// live and stored nowhere; this is where a chosen entry becomes a real
// contact and a real conversation, so the CRM only carries people the
// business has actually reached out to.
//
// Idempotent: picking the same person twice returns the same thread
// rather than creating a second one. That matters because the obvious
// user response to a slow first click is a second click.
//
// Body: { phone, name? }
// Auth: a signed-in member of the account.
// ============================================================

import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { findOrCreateConversation } from '@/lib/whatsapp/find-or-create-conversation'

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
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      phone?: string
      name?: string
    }
    const phone = (body.phone ?? '').replace(/\D/g, '')
    if (!phone) {
      return NextResponse.json({ error: 'A phone number is required' }, { status: 400 })
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null

    // Match on phone_normalized, which the DB generates and keeps unique
    // per account — matching on `phone` would miss the same person stored
    // in a different format and mint a duplicate contact.
    const { data: existing } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('account_id', accountId)
      .eq('phone_normalized', phone)
      .maybeSingle()

    let contactId = existing?.id as string | undefined

    if (!contactId) {
      const { data: created, error } = await supabase
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: user.id,
          phone,
          name,
        })
        .select('id')
        .single()

      if (error || !created) {
        // Someone else may have just created the same contact — the unique
        // index is the arbiter, so re-resolve rather than failing a click.
        const { data: raced } = await supabase
          .from('contacts')
          .select('id')
          .eq('account_id', accountId)
          .eq('phone_normalized', phone)
          .maybeSingle()
        if (!raced) {
          console.error('Error creating contact from directory:', error?.message)
          return NextResponse.json({ error: 'Could not create contact' }, { status: 500 })
        }
        contactId = raced.id as string
      } else {
        contactId = created.id as string
      }
    } else if (name && !existing?.name) {
      // Fill in a name we did not have. Never overwrite one that exists:
      // whatever is stored was more likely set deliberately than the
      // pushName the address book happens to carry.
      await supabase.from('contacts').update({ name }).eq('id', contactId)
    }

    const conversationId = await findOrCreateConversation(
      supabase,
      accountId,
      user.id,
      contactId,
    )
    if (!conversationId) {
      return NextResponse.json(
        { error: 'Could not open a conversation' },
        { status: 500 },
      )
    }

    return NextResponse.json({ conversation_id: conversationId, contact_id: contactId })
  } catch (error) {
    console.error('Error in /api/whatsapp/contacts/start:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
