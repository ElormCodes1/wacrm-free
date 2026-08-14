// ============================================================
// GET /api/search?q=… — search contacts and message bodies
//
// "Find that chat about the invoice" previously had no answer anywhere in
// the app. This searches contacts (name, phone) and message bodies, and
// returns enough context to jump straight to the conversation.
//
// Runs on the caller's own session client, so RLS decides what is
// visible — the policies are already account-scoped
// (is_account_member(account_id)). Re-filtering by account here would be
// duplicated authorisation, and the copy that drifts is the one that
// leaks.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const MAX_LIMIT = 50;

/**
 * Make user input safe inside a PostgREST filter value.
 *
 * `or=(...)` is a comma-separated grammar, so a comma or parenthesis in
 * the query would change the shape of the filter rather than be matched;
 * `%` and `_` are ILIKE wildcards. Quoting handles the grammar, escaping
 * the backslash and quote handles the quoting, and stripping the wildcards
 * keeps a search for "50%" from matching everything.
 */
function sanitiseForFilter(raw: string): string {
  return raw
    .replace(/[\\"]/g, '')
    .replace(/[%_]/g, ' ')
    .replace(/[(),]/g, ' ')
    .trim();
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const raw = (url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(
      Math.max(1, Number(url.searchParams.get('limit')) || 10),
      MAX_LIMIT
    );

    const q = sanitiseForFilter(raw);
    // Two characters is where results stop being noise.
    if (q.length < 2) {
      return NextResponse.json({ query: raw, contacts: [], messages: [] });
    }
    const pattern = `%${q}%`;

    const [contactsRes, messagesRes] = await Promise.all([
      supabase
        .from('contacts')
        .select('id, name, phone, avatar_url, is_group, lid')
        .or(`name.ilike."${pattern}",phone.ilike."${pattern}"`)
        .order('updated_at', { ascending: false })
        .limit(limit),
      supabase
        .from('messages')
        .select(
          'id, conversation_id, content_text, content_type, sender_type, created_at, ' +
            'conversation:conversations(id, contact:contacts(id, name, phone, avatar_url, is_group))'
        )
        .ilike('content_text', pattern)
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

    if (contactsRes.error) {
      console.error('[search] contacts query failed:', contactsRes.error.message);
    }
    if (messagesRes.error) {
      console.error('[search] messages query failed:', messagesRes.error.message);
    }

    return NextResponse.json({
      query: raw,
      contacts: contactsRes.data ?? [],
      messages: messagesRes.data ?? [],
    });
  } catch (error) {
    console.error('Error in /api/search:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
