import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, withMsg91Sim } from "@/lib/msg91-sim/http"
import { getGroup, listJoinRequests } from "@/lib/msg91-sim/groups"

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ group_id: string }> },
) {
  return withMsg91Sim(request, async (supabase) => {
    const { group_id } = await ctx.params
    const groupId = decodeURIComponent(group_id)
    const group = await getGroup(supabase, groupId)
    if (!group) {
      return jsonMsg91(bulkFail("Group not found"), 404)
    }
    const integratedNumber = request.nextUrl.searchParams.get("integrated_number") ?? undefined
    const rows = await listJoinRequests(supabase, groupId, integratedNumber ?? undefined)
    return jsonMsg91(bulkOk(rows))
  })
}
