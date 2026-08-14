// ============================================================
// GET /api/audit — recent account activity
//
// Reads the trail written by the database triggers in migration 061.
// Runs on the caller's session client so RLS decides visibility; the
// policy allows members to SELECT their own account's rows and nothing
// else, and there is deliberately no write policy — the trail cannot be
// edited through the API by the person being audited.
//
// Query: ?limit=&table=&record_id=
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const MAX_LIMIT = 200;

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
    const limit = Math.min(
      Math.max(1, Number(url.searchParams.get('limit')) || 50),
      MAX_LIMIT
    );
    const table = url.searchParams.get('table');
    const recordId = url.searchParams.get('record_id');

    let query = supabase
      .from('audit_log')
      .select('id, actor_user_id, action, table_name, record_id, changes, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (table) query = query.eq('table_name', table);
    if (recordId) query = query.eq('record_id', recordId);

    const { data, error } = await query;
    if (error) {
      console.error('[audit] query failed:', error.message);
      return NextResponse.json({ error: 'Could not load the audit log' }, { status: 500 });
    }

    // Resolve actors to names in one query rather than per row. A null
    // actor is the service role — the webhook or an automation — and is
    // labelled as such rather than left blank, which would read as missing
    // data instead of "no person was involved".
    const actorIds = [...new Set((data ?? []).map((r) => r.actor_user_id).filter(Boolean))];
    const actors: Record<string, string> = {};
    if (actorIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', actorIds as string[]);
      for (const p of profiles ?? []) {
        if (p.full_name) actors[p.user_id as string] = p.full_name as string;
      }
    }

    return NextResponse.json({
      entries: (data ?? []).map((r) => ({
        ...r,
        actor_name: r.actor_user_id ? (actors[r.actor_user_id] ?? 'Unknown user') : 'System',
      })),
    });
  } catch (error) {
    console.error('Error in /api/audit:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
