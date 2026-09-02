import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { applyDemoSendFallback } from "@/lib/whatsapp/deliverAndLogOutbound"
import { buildQuoteDeliveryPayload } from "@/lib/whatsapp/buildQuoteDelivery"
import { serializeWhatsAppMessageLogPayload } from "@/lib/whatsapp/messagePayload"
import { sendWhatsAppMessage } from "@/lib/whatsapp/sendWhatsAppMessage"
import type { QuoteDeliveryPayload, SendWhatsAppResult } from "@/lib/whatsapp/types"

export type DeliverQuoteWhatsAppResult =
  | {
      ok: true
      payload: QuoteDeliveryPayload
      send: SendWhatsAppResult
      channel: "whatsapp" | "demo_simulated"
    }
  | {
      ok: false
      status: number
      message: string
    }

async function persistQuoteDelivery(
  supabase: SupabaseClient,
  payload: QuoteDeliveryPayload,
  send: SendWhatsAppResult,
  channel: "whatsapp" | "demo_simulated",
): Promise<void> {
  const waMessageId = send.waMessageId ?? null
  const waStatus = send.success ? "sent" : "failed"
  const { message } = payload

  const { error: logError } = await supabase.from("whatsapp_message_log").insert({
    trip_request_id: payload.tripRequestId,
    quote_snapshot_id: payload.bestQuoteSnapshotId,
    direction: "outbound",
    body_snapshot: message.bodyText,
    button_payload: serializeWhatsAppMessageLogPayload(message),
    wa_message_id: waMessageId,
    wa_status: waStatus,
    template_name: message.templateKey,
  })

  if (logError) {
    throw new Error(`Failed to log outbound WhatsApp message: ${logError.message}`)
  }

  if (!send.success) return

  const { error: updateSnapshotsError } = await supabase
    .from("quote_snapshots")
    .update({
      status: "sent",
      sent_channel: "whatsapp",
      wa_message_id: waMessageId,
    })
    .in("id", payload.snapshotIds)

  if (updateSnapshotsError) {
    throw new Error(`Failed to update quote snapshots: ${updateSnapshotsError.message}`)
  }

  const { error: updateTripError } = await supabase
    .from("trip_requests")
    .update({ status: "quotes_sent" })
    .eq("id", payload.tripRequestId)

  if (updateTripError) {
    throw new Error(`Failed to update trip request status: ${updateTripError.message}`)
  }

  await supabase
    .from("job_queue")
    .update({ status: "done", last_error: null })
    .eq("job_type", "send_quotes")
    .in("status", ["queued", "processing"])
    .filter("payload->>trip_request_id", "eq", payload.tripRequestId)
}

export async function deliverQuoteWhatsApp(
  supabase: SupabaseClient,
  tripRequestId: string,
): Promise<DeliverQuoteWhatsAppResult> {
  const built = await buildQuoteDeliveryPayload(supabase, tripRequestId)
  if ("error" in built) {
    return { ok: false, status: built.status, message: built.error }
  }

  let send = applyDemoSendFallback(await sendWhatsAppMessage(built.touristPhone, built.message))
  const channel: "whatsapp" | "demo_simulated" = send.simulated ? "demo_simulated" : "whatsapp"

  try {
    await persistQuoteDelivery(supabase, built, send, channel)
  } catch (error) {
    return {
      ok: false,
      status: 500,
      message: error instanceof Error ? error.message : "Failed to persist quote delivery",
    }
  }

  if (!send.success) {
    return {
      ok: false,
      status: 502,
      message: send.error ?? "WhatsApp quote delivery failed",
    }
  }

  return { ok: true, payload: built, send, channel }
}
