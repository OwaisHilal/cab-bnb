import { NextRequest } from "next/server"
import { z } from "zod"
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors"
import { isDemoDebugEnabled } from "@/lib/admin/demoDebugAccess"
import { buildQuoteDeliveryPayload } from "@/lib/whatsapp/buildQuoteDelivery"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"

const querySchema = z.object({
  trip_request_id: z.string().uuid(),
})

export async function GET(request: NextRequest) {
  if (!isDemoDebugEnabled()) {
    return jsonError(404, "Demo debug console is not enabled")
  }

  const parsed = querySchema.safeParse({
    trip_request_id: request.nextUrl.searchParams.get("trip_request_id") ?? undefined,
  })

  if (!parsed.success) return jsonValidationError(parsed.error)

  let supabase
  try {
    supabase = getSupabaseServiceRoleClient()
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured")
  }

  const built = await buildQuoteDeliveryPayload(supabase, parsed.data.trip_request_id)
  if ("error" in built) {
    return jsonError(built.status, built.error)
  }

  return jsonOk({
    trip_request_id: built.tripRequestId,
    tourist_phone: built.touristPhone,
    template_key: built.message.templateKey,
    body_text: built.message.bodyText,
    buttons: built.message.buttons,
    msg91_components: built.message.msg91Components ?? null,
    pending_snapshot_count: built.snapshotIds.length,
  })
}
