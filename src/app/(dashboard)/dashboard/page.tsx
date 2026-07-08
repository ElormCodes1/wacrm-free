import { createClient } from '@/lib/supabase/server'
import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import { DashboardClient } from './dashboard-client'

// Server Component: fetch the dashboard data on the server (RLS-scoped by
// the caller's cookie session) so the initial HTML already contains real
// numbers — no client spinner → auth → fetch waterfall. The interactive
// bits (range switch, number scope) live in DashboardClient, which is
// seeded with this data and refreshes in the background. Each loader is
// caught independently so one failing query can't blank the whole page.
export default async function DashboardPage() {
  const supabase = await createClient()

  const [metrics, series30, pipeline, responseTime, activity] = await Promise.all([
    loadMetrics(supabase).catch(() => null),
    loadConversationsSeries(supabase, 30).catch(() => null),
    loadPipelineDonut(supabase).catch(() => null),
    loadResponseTime(supabase).catch(() => null),
    loadActivity(supabase, 50).catch(() => null),
  ])

  return (
    <DashboardClient
      initial={{ metrics, series30, pipeline, responseTime, activity }}
    />
  )
}
