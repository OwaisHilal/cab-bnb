import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { asRecord, readString, stripPhone } from "@/lib/msg91-sim/ids"
import { injectInbound } from "@/lib/msg91-sim/outbound"

export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    const raw = asRecord(body)
    if (!raw) {
      return jsonMsg91(bulkFail("Request body must be a JSON object"), 400)
    }
    const customerNumber = readString(raw, ["customerNumber", "customer_number", "from"])
    const integratedNumber = readString(raw, ["integratedNumber", "integrated_number", "to"])
    if (!customerNumber || !integratedNumber) {
      return jsonMsg91(bulkFail("customerNumber and integratedNumber are required"), 400)
    }

    const buttonRecord = asRecord(raw.button)
    const button =
      buttonRecord && readString(buttonRecord, ["payload"])
        ? {
            payload: readString(buttonRecord, ["payload"]) as string,
            text: readString(buttonRecord, ["text"]) ?? readString(buttonRecord, ["payload"]) ?? "",
          }
        : typeof raw.button === "string"
          ? (() => {
              try {
                const parsed = JSON.parse(raw.button as string) as { payload?: string; text?: string }
                if (!parsed.payload) return undefined
                return { payload: parsed.payload, text: parsed.text ?? parsed.payload }
              } catch {
                return undefined
              }
            })()
          : undefined

    const result = await injectInbound(supabase, {
      customerNumber: stripPhone(customerNumber),
      integratedNumber: stripPhone(integratedNumber),
      text: readString(raw, ["text"]),
      button,
      contentType: readString(raw, ["contentType", "content_type"]),
    })
    return jsonMsg91(bulkOk(result))
  })
}
