import { formatQuoteChoiceTripSummary } from "@/lib/whatsapp/quoteChoiceTemplate"
import { renderMessageTemplate, getMessageTemplate } from "@/lib/whatsapp/messageTemplateStore"
import type { WhatsAppMessageSpec } from "@/lib/whatsapp/types"

export const TOKEN_RECEIVED_TEMPLATE_KEY = "token_received_v1"

export const buildTokenReceivedAckMessage = (input: {
  tripDays: number
  paxCount: number
  vehicleLabel: string
  pickupLocation?: string | null
  dropLocation?: string | null
  vendorName: string
}): WhatsAppMessageSpec => {
  const template = getMessageTemplate(TOKEN_RECEIVED_TEMPLATE_KEY)
  const tripSummary = formatQuoteChoiceTripSummary({
    tripDays: input.tripDays,
    paxCount: input.paxCount,
    vehicleLabel: input.vehicleLabel,
    pickupLocation: input.pickupLocation,
    dropLocation: input.dropLocation,
  })
  const vendorName = input.vendorName.trim() || "your operator"
  const bodyText = renderMessageTemplate(
    template?.body_template ??
      "Payment received. Your ₹99 token is confirmed.\n\nTrip: {{trip_summary}}\nOperator: {{vendor_name}}\n\nWe are allocating a driver for you. This can take about 30 minutes.",
    { trip_summary: tripSummary, vendor_name: vendorName },
  )

  return {
    templateKey: TOKEN_RECEIVED_TEMPLATE_KEY,
    bodyText,
    buttons: [],
    msg91Components: {
      body_1: { type: "text", value: tripSummary },
      body_2: { type: "text", value: vendorName },
    },
    msg91SendMode: "template",
  }
}
