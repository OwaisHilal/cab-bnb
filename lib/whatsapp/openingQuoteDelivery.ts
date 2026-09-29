import type { SendWhatsAppResult, WhatsAppMsg91SendMode } from "@/lib/whatsapp/types"

/**
 * An opening quote is delivered only when the approved template succeeded,
 * or when templates are off and the session path succeeded. A session
 * fallback while templates are on is not a delivery: WhatsApp drops it on a
 * cold thread and the job must retry.
 */
export const openingQuoteWasDelivered = (input: {
  msg91SendMode: WhatsAppMsg91SendMode
  templatesOn: boolean
  send: SendWhatsAppResult
}): boolean => {
  if (!input.send.success) return false
  if (input.send.simulated) return true
  if (!input.templatesOn || input.msg91SendMode !== "template") return true
  return input.send.channel === "template"
}
