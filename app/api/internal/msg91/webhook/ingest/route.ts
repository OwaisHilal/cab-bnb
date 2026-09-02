import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { asRecord } from "@/lib/msg91-sim/ids"
import { persistWebhookEvent } from "@/lib/msg91-sim/webhooks"

export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    const raw = asRecord(body)
    if (!raw) {
      return jsonMsg91(bulkFail("Request body must be a JSON object"), 400)
    }
    await persistWebhookEvent(supabase, raw)
    return jsonMsg91(bulkOk({ ingested: true }))
  })
}
