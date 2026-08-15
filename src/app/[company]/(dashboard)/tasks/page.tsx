import { createClient } from "@/lib/supabase/server";
import type { Task } from "@/types";
import { TasksClient } from "./tasks-client";

// Server Component: render the task list into the initial HTML (RLS-scoped
// by the cookie session). TasksClient is seeded with it and owns the form,
// completion toggles, and refresh.
export default async function TasksPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initial: Task[] = [];
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (accountId) {
      const { data } = await supabase
        .from("tasks")
        .select(
          "*, contact:contacts(id,name,phone), assignee:profiles!tasks_assigned_to_fkey(id,full_name,email), deal:deals(id,title)",
        )
        .eq("account_id", accountId)
        .order("status")
        .order("due_date", { nullsFirst: false });
      initial = (data ?? []) as unknown as Task[];
    }
  }

  return <TasksClient initial={initial} />;
}
