import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { getGroup } from "@/lib/msg91-sim/groups"

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ group_id: string }> },
) {
  return withMsg91Sim(request, async (supabase) => {
    const { group_id } = await ctx.params
    const group = await getGroup(supabase, decodeURIComponent(group_id))
    if (!group) {
      return jsonMsg91(bulkFail("Group not found"), 404)
    }
    const body = await readOptionalJson(request)
    return jsonMsg91(bulkOk({ group_id: group.id, sent: true, echo: body }))
  })
}
