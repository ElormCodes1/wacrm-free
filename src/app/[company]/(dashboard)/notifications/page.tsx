import { createClient } from "@/lib/supabase/server";
import type { Notification } from "@/types";
import { NotificationsClient } from "./notifications-client";

// Server Component: render the notifications list into the initial HTML
// (RLS-scoped by the cookie session). The island is seeded with it and
// keeps the realtime updates + mark-read actions.
export default async function NotificationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initial: Notification[] = [];
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (accountId) {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(100);
      initial = (data ?? []) as Notification[];
    }
  }

  return <NotificationsClient initial={initial} />;
}
