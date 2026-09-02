import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { createGroup, listGroups } from "@/lib/msg91-sim/groups"
import { asRecord } from "@/lib/msg91-sim/ids"

export async function GET(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const rows = await listGroups(supabase)
    return jsonMsg91(bulkOk(rows))
  })
}

export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    if (body === null) {
      return jsonMsg91(bulkFail("Request body must be valid JSON"), 400)
    }
    const raw = asRecord(body) ?? {}
    const row = await createGroup(supabase, raw)
    return jsonMsg91(bulkOk(row))
  })
}
