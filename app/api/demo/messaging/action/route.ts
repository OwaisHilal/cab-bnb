import { NextRequest } from "next/server"
import { z } from "zod"
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors"
import { isDemoMode } from "@/lib/otp/demoMode"
import { loadDemoMockChatThread } from "@/lib/demo/ensureMockChatQuotes"
import { handleMockMessagingAction } from "@/lib/demo/mockMessaging"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"

const bodySchema = z.object({
  trip_request_id: z.string().uuid(),
  button_payload: z.string().min(1),
  button_title: z.string().min(1).optional(),
  selected_quote_id: z.string().uuid().optional(),
})

export async function POST(request: NextRequest) {
  if (!isDemoMode()) {
    return jsonError(404, "Demo messaging is not enabled")
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

  try {
    const result = await handleMockMessagingAction(
      supabase,
      parsed.data.trip_request_id,
      parsed.data.button_payload,
      parsed.data.button_title,
    )

    if (!result.ok) {
      return jsonError(result.status, result.message)
    }

    const thread = await loadDemoMockChatThread(supabase, parsed.data.trip_request_id, {
      quoteSnapshotId: parsed.data.selected_quote_id,
    })

    return jsonOk({ result, thread })
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Mock messaging action failed")
  }
}
