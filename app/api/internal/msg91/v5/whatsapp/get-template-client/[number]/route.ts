import type { NextRequest } from "next/server"
import { bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, withMsg91Sim } from "@/lib/msg91-sim/http"
import { listTemplates } from "@/lib/msg91-sim/templates"

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ number: string }> },
) {
  return withMsg91Sim(request, async (supabase) => {
    const { number } = await ctx.params
    const search = request.nextUrl.searchParams
    const pageSizeRaw = search.get("page_size")
    const pageNumRaw = search.get("page_num")
    const result = await listTemplates(supabase, {
      number,
      templateName: search.get("template_name") ?? undefined,
      templateStatus: search.get("template_status") ?? undefined,
      templateLanguage: search.get("template_language") ?? undefined,
      pagination: search.get("pagination") ?? undefined,
      pageSize: pageSizeRaw ? Number(pageSizeRaw) : undefined,
      pageNum: pageNumRaw ? Number(pageNumRaw) : undefined,
    })

    if (result.paginated) {
      return jsonMsg91(
        bulkOk({
          data: result.rows,
          hasMoreData: result.hasMoreData,
          total_count: result.total,
        }),
      )
    }

    return jsonMsg91(bulkOk(result.rows))
  })
}
