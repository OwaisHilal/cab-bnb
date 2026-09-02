import type { NextRequest } from "next/server"
import { validateLogWindow } from "@/lib/msg91-sim/dates"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, withMsg91Sim } from "@/lib/msg91-sim/http"
import { listLogs } from "@/lib/msg91-sim/reports"

export async function GET(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const startDate = request.nextUrl.searchParams.get("startDate") ?? ""
    const endDate = request.nextUrl.searchParams.get("endDate") ?? ""
    const window = validateLogWindow(startDate, endDate)
    if (!window.ok) {
      return jsonMsg91(bulkFail(window.message), 400)
    }
    const rows = await listLogs(supabase, window.start, window.end)
    return jsonMsg91(bulkOk(rows))
  })
}
