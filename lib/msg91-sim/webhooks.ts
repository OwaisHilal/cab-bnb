import type { SupabaseClient } from "@supabase/supabase-js"
import { after } from "next/server"
import {
  buildOutboundWebhookPayload,
  type OutboundWebhookInput,
} from "./webhookPayload"

export {
  buildInboundWebhookPayload,
  buildOutboundWebhookPayload,
} from "./webhookPayload"
export type { InboundWebhookInput, OutboundWebhookInput } from "./webhookPayload"

export async function persistWebhookEvent(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<void> {
  const eventName = typeof payload.eventName === "string" ? payload.eventName : "unknown"
  const uuid = typeof payload.uuid === "string" ? payload.uuid : null
  const requestId = typeof payload.requestId === "string" ? payload.requestId : null

  const { error } = await supabase.from("msg91_sim_webhook_events").insert({
    event_name: eventName,
    uuid,
    request_id: requestId,
    payload,
  })
  if (error) {
    throw new Error(error.message)
  }
}

export async function persistOutboundStatusTrail(
  supabase: SupabaseClient,
  base: Omit<OutboundWebhookInput, "eventName" | "ts"> & { requestedAt: string },
): Promise<void> {
  const events: Array<OutboundWebhookInput["eventName"]> = ["sent", "delivered", "read"]
  const payloads = events.map((eventName) =>
    buildOutboundWebhookPayload({
      ...base,
      eventName,
      ts: base.requestedAt,
    }),
  )

  for (const payload of payloads) {
    await persistWebhookEvent(supabase, payload)
  }

  await supabase
    .from("msg91_sim_messages")
    .update({ wa_status: "read" })
    .eq("uuid", base.uuid)

  const callbackUrl = process.env.MSG91_SIM_WEBHOOK_URL?.trim()
  if (!callbackUrl) {
    return
  }

  after(async () => {
    for (const payload of payloads) {
      try {
        const response = await fetch(callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (response.ok) {
          await supabase
            .from("msg91_sim_webhook_events")
            .update({ delivered_to_callback_at: new Date().toISOString() })
            .eq("uuid", base.uuid)
            .eq("event_name", payload.eventName)
        }
      } catch {
        // Simulator callback is best-effort; stored events remain the source of truth.
      }
    }
  })
}
