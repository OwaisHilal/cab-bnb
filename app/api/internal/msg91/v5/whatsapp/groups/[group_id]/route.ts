import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, withMsg91Sim } from "@/lib/msg91-sim/http"
import { deleteGroup, getGroup } from "@/lib/msg91-sim/groups"

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ group_id: string }> },
) {
  return withMsg91Sim(request, async (supabase) => {
    const { group_id } = await ctx.params
    const row = await getGroup(supabase, decodeURIComponent(group_id))
    if (!row) {
      return jsonMsg91(bulkFail("Group not found"), 404)
    }
    return jsonMsg91(bulkOk(row))
  })
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ group_id: string }> },
) {
  return withMsg91Sim(request, async (supabase) => {
    const { group_id } = await ctx.params
    const deleted = await deleteGroup(supabase, decodeURIComponent(group_id))
    if (!deleted) {
      return jsonMsg91(bulkFail("Group not found"), 404)
    }
    return jsonMsg91(bulkOk({ deleted: true }))
  })
}
