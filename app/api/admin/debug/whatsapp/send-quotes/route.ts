import { NextRequest } from "next/server"
import { z } from "zod"
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors"
import { isDemoDebugEnabled } from "@/lib/admin/demoDebugAccess"
import { deliverQuoteWhatsApp } from "@/lib/whatsapp/deliverQuoteWhatsApp"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"

const bodySchema = z.object({
  trip_request_id: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  if (!isDemoDebugEnabled()) {
    return jsonError(404, "Demo debug console is not enabled")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, "Request body must be valid JSON")
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return jsonValidationError(parsed.error)

  let supabase
  try {
    supabase = getSupabaseServiceRoleClient()
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured")
  }

  const result = await deliverQuoteWhatsApp(supabase, parsed.data.trip_request_id)
  if (!result.ok) {
    return jsonError(result.status, result.message)
  }

  return jsonOk({
    channel: result.channel,
    simulated: Boolean(result.send.simulated),
    wa_message_id: result.send.waMessageId ?? null,
    tourist_phone: result.payload.touristPhone,
    body_text: result.payload.message.bodyText,
    template_key: result.payload.message.templateKey,
    buttons: result.payload.message.buttons,
  })
}
