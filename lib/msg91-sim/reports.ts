import type { SupabaseClient } from "@supabase/supabase-js"

export async function listLogs(
  supabase: SupabaseClient,
  start: Date,
  end: Date,
): Promise<unknown[]> {
  const { data, error } = await supabase
    .from("msg91_sim_webhook_events")
    .select("event_name, uuid, request_id, payload, created_at")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at", { ascending: false })
    .limit(1000)

  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []).map((row) => row.payload)
}

export async function listAnalytics(
  supabase: SupabaseClient,
  start: Date,
  end: Date,
): Promise<{
  totals: Record<string, number>
  by_event: Array<{ event_name: string; count: number }>
}> {
  const { data, error } = await supabase
    .from("msg91_sim_webhook_events")
    .select("event_name")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())

  if (error) {
    throw new Error(error.message)
  }

  const totals: Record<string, number> = {}
  for (const row of data ?? []) {
    const name = row.event_name ?? "unknown"
    totals[name] = (totals[name] ?? 0) + 1
  }

  return {
    totals,
    by_event: Object.entries(totals).map(([event_name, count]) => ({ event_name, count })),
  }
}
