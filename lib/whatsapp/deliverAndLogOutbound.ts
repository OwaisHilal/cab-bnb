import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isDemoMode } from "@/lib/otp/demoMode"
import { serializeWhatsAppMessageLogPayload, type WhatsAppMessageLogPayload } from "@/lib/whatsapp/messagePayload"
import { sendWhatsAppMessage } from "@/lib/whatsapp/sendWhatsAppMessage"
import { sendWhatsAppTextMessage } from "@/lib/whatsapp/sendOutbound"
import type { SendWhatsAppResult, WhatsAppMessageSpec } from "@/lib/whatsapp/types"
import { toIndianE164 } from "@/lib/utils/phone"

export function normalizeOutboundPhoneE164(phone: string): string {
  const trimmed = phone.trim()
  if (trimmed.startsWith("+")) return trimmed

  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 10) return toIndianE164(digits)
  if (digits.startsWith("91") && digits.length >= 12) return `+${digits}`

  return trimmed.length > 0 ? `+${digits}` : trimmed
}

/** When MSG91/Meta is unavailable, demo mode still advances the flow and mock chat. */
export function applyDemoSendFallback(send: SendWhatsAppResult): SendWhatsAppResult {
  if (send.success) return send
  if (!isDemoMode()) return send

  return {
    configured: send.configured,
    success: true,
    simulated: true,
    waMessageId: `demo-wamid-${randomUUID()}`,
  }
}

interface MessageLogContext {
  tripRequestId: string
  bookingId?: string
  vendorId?: string
  touristId?: string
  direction?: "outbound" | "inbound"
  interactionType?: "button_click" | "free_text"
}

async function persistOutboundLog(
  supabase: SupabaseClient,
  input: MessageLogContext & {
    bodySnapshot: string
    buttonPayload: string
    templateName: string
    send: SendWhatsAppResult
  },
): Promise<void> {
  const { error } = await supabase.from("whatsapp_message_log").insert({
    trip_request_id: input.tripRequestId,
    booking_id: input.bookingId ?? null,
    vendor_id: input.vendorId ?? null,
    tourist_id: input.touristId ?? null,
    direction: input.direction ?? "outbound",
    body_snapshot: input.bodySnapshot,
    button_payload: input.buttonPayload,
    interaction_type: input.interactionType ?? null,
    wa_message_id: input.send.waMessageId ?? null,
    wa_status: input.send.success ? (input.send.simulated ? "demo_simulated" : "sent") : "failed",
    template_name: input.templateName,
  })

  if (error) {
    throw new Error(`Failed to log WhatsApp message: ${error.message}`)
  }
}

/**
 * Same path as production: MSG91 session list/button/text (or Meta fallback),
 * then whatsapp_message_log for mock chat + admin flow. Demo only fakes success
 * when outbound credentials are missing.
 */
export async function deliverAndLogWhatsAppSpec(
  supabase: SupabaseClient,
  input: {
    phoneE164: string
    spec: WhatsAppMessageSpec
    log: MessageLogContext
    media?: WhatsAppMessageLogPayload["media"]
    bodyOverride?: string
    templateName?: string
  },
): Promise<SendWhatsAppResult> {
  const phoneE164 = normalizeOutboundPhoneE164(input.phoneE164)
  const rawSend = await sendWhatsAppMessage(phoneE164, input.spec)
  const send = applyDemoSendFallback(rawSend)

  await persistOutboundLog(supabase, {
    ...input.log,
    bodySnapshot: input.bodyOverride ?? input.spec.bodyText,
    buttonPayload: serializeWhatsAppMessageLogPayload(input.spec, input.media),
    templateName: input.templateName ?? input.spec.templateKey,
    send,
  })

  if (!send.success) {
    throw new Error(send.error ?? "WhatsApp delivery failed")
  }

  return send
}

export async function deliverAndLogWhatsAppText(
  supabase: SupabaseClient,
  input: {
    phoneE164: string
    bodyText: string
    templateName: string
    log: MessageLogContext
    templateKey?: string
  },
): Promise<SendWhatsAppResult> {
  const phoneE164 = normalizeOutboundPhoneE164(input.phoneE164)
  const rawSend = await sendWhatsAppTextMessage(phoneE164, input.bodyText)
  const send = applyDemoSendFallback(rawSend)

  await persistOutboundLog(supabase, {
    ...input.log,
    bodySnapshot: input.bodyText,
    buttonPayload: JSON.stringify({ templateKey: input.templateKey ?? input.templateName }),
    templateName: input.templateName,
    send,
  })

  if (!send.success) {
    throw new Error(send.error ?? "WhatsApp text delivery failed")
  }

  return send
}
