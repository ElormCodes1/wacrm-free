import { createClient } from "@/lib/supabase/server"
import type { Automation } from "@/types"
import { AutomationsClient } from "./automations-client"

// Server Component: render the automations list into the initial HTML
// (RLS-scoped by the cookie session). AutomationsClient is seeded with it
// and owns the toggle/delete/create flows.
export default async function AutomationsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from("automations")
    .select("*")
    .order("created_at", { ascending: false })

  return <AutomationsClient initial={(data ?? []) as Automation[]} />
}
