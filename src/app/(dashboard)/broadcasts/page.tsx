import { createClient } from '@/lib/supabase/server';
import type { Broadcast } from '@/types';
import { BroadcastsClient } from './broadcasts-client';

// Server Component: render the broadcasts list into the initial HTML
// (RLS-scoped by the cookie session). BroadcastsClient is seeded with it
// and only talks to Supabase to poll live progress while sending.
export default async function BroadcastsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('broadcasts')
    .select('*')
    .order('created_at', { ascending: false });

  return <BroadcastsClient initial={(data ?? []) as Broadcast[]} />;
}
