import type { NextRequest } from "next/server"
import { sessionError, sessionSuccess } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { sendSession } from "@/lib/msg91-sim/outbound"
import { parseSessionRequest } from "@/lib/msg91-sim/parseBody"

export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    if (body === null) {
      return jsonMsg91(sessionError("Request body must be valid JSON"), 400)
    }
    const parsed = parseSessionRequest(body, request.nextUrl.searchParams)
    if (!parsed.ok) {
      return jsonMsg91(sessionError(parsed.message), 400)
    }
    const result = await sendSession(supabase, parsed.value)
    return jsonMsg91(sessionSuccess(result.uuid))
  })
}
