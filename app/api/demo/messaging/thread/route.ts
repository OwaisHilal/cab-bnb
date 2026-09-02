import { NextRequest } from "next/server"
import { z } from "zod"
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors"
import { isDemoMode } from "@/lib/otp/demoMode"
import { loadDemoMockChatThread } from "@/lib/demo/ensureMockChatQuotes"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"

const querySchema = z.object({
  trip_request_id: z.string().uuid(),
  audience: z.enum(["customer", "admin"]).optional(),
  selected_quote_id: z.string().uuid().optional(),
})

export async function GET(request: NextRequest) {
  if (!isDemoMode()) {
    return jsonError(404, "Demo messaging is not enabled")
  }

  const parsed = querySchema.safeParse({
    trip_request_id: request.nextUrl.searchParams.get("trip_request_id") ?? undefined,
    audience: request.nextUrl.searchParams.get("audience") ?? undefined,
    selected_quote_id: request.nextUrl.searchParams.get("selected_quote_id") ?? undefined,
  })

  if (!parsed.success) return jsonValidationError(parsed.error)

  let supabase
  try {
    supabase = getSupabaseServiceRoleClient()
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured")
  }

  try {
    const thread = await loadDemoMockChatThread(supabase, parsed.data.trip_request_id, {
      includeVendorMessages: parsed.data.audience === "admin",
      quoteSnapshotId: parsed.data.selected_quote_id,
    })
    if (!thread) return jsonError(404, "Trip request not found")
    return jsonOk(thread)
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to load messaging thread")
  }
}
