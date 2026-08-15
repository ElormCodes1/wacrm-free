import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { privilegedClient } from '@/lib/supabase/privileged';

// Lazy, shared service-role client for automation engine work.
// Mirrors the pattern used by the webhook handler
// (src/app/api/whatsapp/webhook/route.ts).
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = privilegedClient('background-engine')
  }
  return _adminClient
}
