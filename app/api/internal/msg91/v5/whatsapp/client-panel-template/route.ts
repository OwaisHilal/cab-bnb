import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { extractTemplateFields, parseDeleteTemplateQuery } from "@/lib/msg91-sim/parseBody"
import { createTemplate, deleteTemplateByName } from "@/lib/msg91-sim/templates"

export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    if (body === null) {
      return jsonMsg91(bulkFail("Request body must be valid JSON"), 400)
    }
    const raw = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}
    const fields = extractTemplateFields(body)
    if (!fields.name) {
      return jsonMsg91(bulkFail("template name is required"), 400)
    }
    const row = await createTemplate(supabase, fields, raw)
    return jsonMsg91(bulkOk({ ...row, template_id: row.id }))
  })
}

export async function DELETE(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const parsed = parseDeleteTemplateQuery(request.nextUrl.searchParams)
    if (!parsed.ok) {
      return jsonMsg91(bulkFail(parsed.message), 400)
    }
    const deleted = await deleteTemplateByName(
      supabase,
      parsed.value.templateName,
      parsed.value.integratedNumber,
    )
    if (deleted === 0) {
      return jsonMsg91(bulkFail("Template not found"), 404)
    }
    return jsonMsg91(bulkOk({ deleted }))
  })
}
