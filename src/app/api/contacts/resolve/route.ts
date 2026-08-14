// ============================================================
// POST /api/contacts/resolve — phone → contact (+ conversation)
//
// Backs clicking an @mention or a group member's name in the inbox. Those
// point at a phone number, not a CRM record: a person mentioned in a group
// often isn't a contact yet, and the whole point of the affordance is to
// go straight to them without a detour through a search box.
//
// So this finds or creates the contact for a phone within the caller's
// account and returns it alongside the conversation id, which the sidebar
// uses for its "Message" button.
//
// Body:  { "phone": "233241035885", "name": "Ama" }   // name optional
// 200:   { "contact": {...}, "conversation_id": "<uuid>", "created": bool }
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { SendMessageError } from '@/lib/whatsapp/send-message';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      phone?: string;
      name?: string | null;
    };
    const phone = (body.phone ?? '').trim();
    if (!phone) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 });
    }

    // Shared with the public send API, so a contact created by clicking a
    // mention is identical to one created by sending to a new number —
    // same normalisation, same dedupe, same conversation tagging.
    const resolved = await resolveConversationByPhone(
      supabase,
      accountId,
      phone,
      body.name ?? null
    );

    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', resolved.contactId)
      .single();
    if (contactErr || !contact) {
      return NextResponse.json(
        { error: 'Contact could not be loaded' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      contact,
      conversation_id: resolved.conversationId,
      created: resolved.contactCreated,
    });
  } catch (error) {
    if (error instanceof SendMessageError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error('Error in /api/contacts/resolve:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
