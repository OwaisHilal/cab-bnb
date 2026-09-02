import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { injectJoinRequest } from "@/lib/msg91-sim/groups"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { asRecord, readString } from "@/lib/msg91-sim/ids"

export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    const raw = asRecord(body)
    if (!raw) {
      return jsonMsg91(bulkFail("Request body must be a JSON object"), 400)
    }
    const groupId = readString(raw, ["group_id", "groupId"])
    const waId = readString(raw, ["wa_id", "waId", "customerNumber"])
    if (!groupId || !waId) {
      return jsonMsg91(bulkFail("group_id and wa_id are required"), 400)
    }
    try {
      const row = await injectJoinRequest(supabase, {
        groupId,
        waId,
        displayName: readString(raw, ["display_name", "displayName", "name"]),
        integratedNumber: readString(raw, ["integrated_number", "integratedNumber"]),
        raw,
      })
      return jsonMsg91(bulkOk(row))
    } catch (error) {
      return jsonMsg91(bulkFail(error instanceof Error ? error.message : "Failed"), 400)
    }
  })
}
