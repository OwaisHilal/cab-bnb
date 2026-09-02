import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { extractTemplateFields } from "@/lib/msg91-sim/parseBody"
import { updateTemplate } from "@/lib/msg91-sim/templates"

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ template_id: string }> },
) {
  return withMsg91Sim(request, async (supabase) => {
    const { template_id } = await ctx.params
    const body = await readOptionalJson(request)
    if (body === null) {
      return jsonMsg91(bulkFail("Request body must be valid JSON"), 400)
    }
    const raw = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}
    const fields = extractTemplateFields(body)
    const row = await updateTemplate(supabase, template_id, fields, raw)
    if (!row) {
      return jsonMsg91(bulkFail("Template not found"), 404)
    }
    return jsonMsg91(bulkOk({ ...row, template_id: row.id }))
  })
}
