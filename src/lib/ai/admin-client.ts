import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { privilegedClient } from '@/lib/supabase/privileged';

// Lazy, shared service-role client for the AI auto-reply path.
// Mirrors src/lib/flows/admin-client.ts and src/lib/automations/admin-client.ts
// — the inbound webhook has no `auth.uid()`, so the bot reads config +
// conversation state and sends through the service role.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = privilegedClient('background-engine')
  }
  return _adminClient
}
