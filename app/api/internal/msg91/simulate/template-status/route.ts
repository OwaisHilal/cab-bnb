import type { NextRequest } from "next/server"
import { bulkFail, bulkOk, isTemplateStatus } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { asRecord, readString } from "@/lib/msg91-sim/ids"
import { setTemplateStatus } from "@/lib/msg91-sim/templates"

export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    const raw = asRecord(body)
    if (!raw) {
      return jsonMsg91(bulkFail("Request body must be a JSON object"), 400)
    }
    const status = (readString(raw, ["template_status", "status"]) ?? "").toLowerCase()
    if (!isTemplateStatus(status)) {
      return jsonMsg91(bulkFail("template_status must be pending, approved, or rejected"), 400)
    }
    const row = await setTemplateStatus(supabase, {
      id: readString(raw, ["id", "template_id"]),
      name: readString(raw, ["name", "template_name"]),
      templateStatus: status,
    })
    if (!row) {
      return jsonMsg91(bulkFail("Template not found"), 404)
    }
    return jsonMsg91(bulkOk(row))
  })
}
