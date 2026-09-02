import type { NextRequest } from "next/server"
import { validateAnalyticsWindow } from "@/lib/msg91-sim/dates"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, withMsg91Sim } from "@/lib/msg91-sim/http"
import { listAnalytics } from "@/lib/msg91-sim/reports"

export async function GET(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const startDate = request.nextUrl.searchParams.get("startDate") ?? undefined
    const endDate = request.nextUrl.searchParams.get("endDate") ?? undefined
    const window = validateAnalyticsWindow(startDate, endDate)
    if (!window.ok) {
      return jsonMsg91(bulkFail(window.message), 400)
    }
    const data = await listAnalytics(supabase, window.start, window.end)
    return jsonMsg91(bulkOk(data))
  })
}
