import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { deliverQuoteWhatsApp } from "@/lib/whatsapp/deliverQuoteWhatsApp"
import { phoneLast4 } from "@/lib/utils/phone"

export const handleSendQuotes = async (
  supabase: SupabaseClient,
  payload: { trip_request_id?: string },
): Promise<void> => {
  const tripRequestId = payload.trip_request_id
  if (typeof tripRequestId !== "string" || tripRequestId.length === 0) {
    throw new Error("send_quotes payload is missing trip_request_id")
  }

  const result = await deliverQuoteWhatsApp(supabase, tripRequestId)
  if (!result.ok) {
    console.info("[quotes send] failed", { tripRequestId, message: result.message })
    throw new Error(result.message)
  }

  const last4 = phoneLast4(result.payload.touristPhone)
  console.info("[quotes send] ok", {
    last4,
    template: result.payload.message.templateKey,
    sendMode: result.payload.message.msg91SendMode,
    channel: result.channel,
    configured: result.send.configured,
    success: result.send.success,
    simulated: Boolean(result.send.simulated),
    waMessageId: result.send.waMessageId ?? null,
  })
}
