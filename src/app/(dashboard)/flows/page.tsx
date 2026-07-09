import { createClient } from "@/lib/supabase/server";
import { listFlowTemplates } from "@/lib/flows/templates";
import {
  FlowsClient,
  type FlowRow,
  type TemplateSummary,
} from "./flows-client";

// Server Component: render the flows list + the (static) template gallery
// into the initial HTML — mirrors GET /api/flows and /api/flows/templates,
// RLS-scoped by the cookie session. FlowsClient is seeded with it and owns
// create/clone/navigation.
export default async function FlowsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("flows")
    .select("*")
    .order("created_at", { ascending: false });

  const templates: TemplateSummary[] = listFlowTemplates().map((t) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    icon: t.icon,
    trigger_type: t.trigger_type,
    node_count: t.nodes.length,
  }));

  return (
    <FlowsClient
      initial={{ flows: (data ?? []) as FlowRow[], templates }}
    />
  );
}
