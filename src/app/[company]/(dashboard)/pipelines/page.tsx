import { createClient } from "@/lib/supabase/server";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelinesClient } from "./pipelines-client";

// Server Component: render the initial pipeline board into the HTML. Reads
// the ?pipeline= deep-link so the inbox → deal link lands on the right board
// with no flash. RLS-scoped by the cookie session. The interactive board
// (drag, deal CRUD, pipeline switch, seed-if-empty for brand-new accounts)
// lives in PipelinesClient, seeded with this.
export default async function PipelinesPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; deal?: string }>;
}) {
  const { pipeline: deepPipelineId } = await searchParams;
  const supabase = await createClient();

  const { data: pipelinesData } = await supabase
    .from("pipelines")
    .select("*")
    .order("created_at");
  const pipelines = (pipelinesData ?? []) as Pipeline[];

  let selectedPipelineId = "";
  if (pipelines.length > 0) {
    selectedPipelineId =
      deepPipelineId && pipelines.some((p) => p.id === deepPipelineId)
        ? deepPipelineId
        : pipelines[0].id;
  }

  let stages: PipelineStage[] = [];
  let deals: Deal[] = [];
  if (selectedPipelineId) {
    const [s, d] = await Promise.all([
      supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", selectedPipelineId)
        .order("position"),
      supabase
        .from("deals")
        .select(
          "*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)",
        )
        .eq("pipeline_id", selectedPipelineId)
        .order("created_at", { ascending: false }),
    ]);
    stages = (s.data ?? []) as PipelineStage[];
    deals = (d.data ?? []) as Deal[];
  }

  return (
    <PipelinesClient
      initial={{ pipelines, selectedPipelineId, stages, deals }}
    />
  );
}
