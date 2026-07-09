import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Broadcast, BroadcastRecipient } from '@/types';
import { BroadcastDetailClient } from './broadcast-detail-client';

// Server Component: fetch the broadcast + its recipients on the server
// (RLS-scoped by the cookie session) and hand them to the interactive
// island. First paint shows the full report — no client fetch waterfall.
export default async function BroadcastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: broadcast } = await supabase
    .from('broadcasts')
    .select('*')
    .eq('id', id)
    .single();

  if (!broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">Broadcast not found</p>
        <Link
          href="/broadcasts"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          Back to Broadcasts
        </Link>
      </div>
    );
  }

  const { data: recipients } = await supabase
    .from('broadcast_recipients')
    .select('*, contact:contacts(*)')
    .eq('broadcast_id', id)
    .order('created_at', { ascending: false });

  return (
    <BroadcastDetailClient
      broadcast={broadcast as Broadcast}
      recipients={(recipients ?? []) as BroadcastRecipient[]}
    />
  );
}
