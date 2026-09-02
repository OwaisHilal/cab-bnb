import type { NextRequest } from "next/server"
import { bulkFail, bulkSuccess } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { sendBulk } from "@/lib/msg91-sim/outbound"
import { parseBulkBody } from "@/lib/msg91-sim/parseBody"

export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    if (body === null) {
      return jsonMsg91(bulkFail("Request body must be valid JSON"), 400)
    }
    const parsed = parseBulkBody(body)
    if (!parsed.ok) {
      return jsonMsg91(bulkFail(parsed.message), 400)
    }
    const result = await sendBulk(supabase, parsed.value)
    if (!result.ok) {
      return jsonMsg91(bulkFail(result.message), 400)
    }
    return jsonMsg91(bulkSuccess(result.requestId, result.uuid))
  })
}
