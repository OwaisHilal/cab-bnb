import { parseWhatsAppMessageLogPayload } from "@/lib/whatsapp/messagePayload"

export type MessagingFlowAudience = "customer" | "vendor" | "driver"

export type MessagingFlowKind = "text" | "button" | "list"

export interface MessagingFlowStep {
  id: string
  label: string
  audience: MessagingFlowAudience
  description: string
}

export const MESSAGING_FLOW_STEPS: MessagingFlowStep[] = [
  {
    id: "quote",
    label: "1 · Quote",
    audience: "customer",
    description: "Select {vendor} buttons or Pay ₹99",
  },
  {
    id: "vendor_notify",
    label: "2 · Nova notify",
    audience: "vendor",
    description: "Text — assign driver reply format",
  },
  {
    id: "vendor_reply",
    label: "3 · Driver details",
    audience: "vendor",
    description: "Inbound DRIVER: name | phone | plate | model",
  },
  {
    id: "balance",
    label: "4 · Balance",
    audience: "customer",
    description: "Interactive button — Pay balance Now",
  },
  {
    id: "driver_contact",
    label: "5 · Driver contact",
    audience: "customer",
    description: "Text — driver phone + vehicle",
  },
  {
    id: "driver_assign",
    label: "6 · Driver assign",
    audience: "driver",
    description: "Text — route, guest, vehicle",
  },
  {
    id: "ride_group_guest",
    label: "7 · Ride group (guest)",
    audience: "customer",
    description: "Join ride group — quality control",
  },
  {
    id: "ride_group_driver",
    label: "8 · Ride group (driver)",
    audience: "driver",
    description: "Join ride group with passenger",
  },
]

const AUDIENCE_LABELS: Record<MessagingFlowAudience, string> = {
  customer: "Guest",
  vendor: "Nova / vendor",
  driver: "Driver",
}

const AUDIENCE_STYLES: Record<MessagingFlowAudience, string> = {
  customer: "bg-[#d9fdd3] text-[#005c4b]",
  vendor: "bg-kmr-blue/15 text-kmr-blue-dark",
  driver: "bg-kmr-orange/15 text-kmr-orange-dark",
}

const KIND_LABELS: Record<MessagingFlowKind, string> = {
  text: "Text",
  button: "Interactive · buttons",
  list: "Interactive · list",
}

export function classifyMessagingAudience(input: {
  template_name: string | null
  vendor_id: string | null
  tourist_id?: string | null
  direction: "outbound" | "inbound"
}): MessagingFlowAudience {
  if (input.template_name === "driver_assignment_v1" || input.template_name === "ride_group_driver_v1") return "driver"
  if (input.vendor_id) return "vendor"
  if (
    input.template_name === "vendor_booking_notify_v1" ||
    input.template_name === "vendor_assign_driver_v1" ||
    input.template_name === "vendor_inbound_driver_reply"
  ) {
    return "vendor"
  }
  return "customer"
}

export function classifyMessagingKind(buttonPayload: string | null): MessagingFlowKind {
  const payload = parseWhatsAppMessageLogPayload(buttonPayload)
  if (payload.list?.sections.some((section) => section.rows.length > 0)) return "list"
  if (payload.ctaUrl?.url || payload.buttons.length > 0) return "button"
  return "text"
}

export function getAudienceLabel(audience: MessagingFlowAudience): string {
  return AUDIENCE_LABELS[audience]
}

export function getAudienceStyle(audience: MessagingFlowAudience): string {
  return AUDIENCE_STYLES[audience]
}

export function getKindLabel(kind: MessagingFlowKind): string {
  return KIND_LABELS[kind]
}

export function inferFlowStepId(input: {
  template_name: string | null
  vendor_id: string | null
  direction: "outbound" | "inbound"
  body_snapshot: string | null
}): string | null {
  if (input.template_name === "quote_single_v1" || input.template_name === "quote_multi_v1" || input.template_name === "quote_choice_v1") {
    return "quote"
  }
  if (input.template_name === "vendor_booking_notify_v1" || input.template_name === "vendor_assign_driver_v1") {
    return "vendor_notify"
  }
  if (
    input.template_name === "vendor_inbound_driver_reply" ||
    (input.direction === "inbound" && input.vendor_id && (
      input.body_snapshot?.startsWith("DRIVER:") ||
      /^\+?[\d\s\-()]{10,20}$/.test(input.body_snapshot?.trim() ?? "")
    ))
  ) {
    return "vendor_reply"
  }
  if (input.template_name === "token_received_v1") return "token_ack"
  if (input.template_name === "driver_assigned_payment_v1" || input.template_name === "driver_balance_v1") return "balance"
  if (input.template_name === "driver_contact_v1") return "driver_contact"
  if (input.template_name === "driver_assignment_v1") return "driver_assign"
  if (input.template_name === "ride_group_guest_v1") return "ride_group_guest"
  if (input.template_name === "ride_group_driver_v1") return "ride_group_driver"
  if (input.body_snapshot?.includes("Booking confirmed")) return "quote"
  if (input.body_snapshot?.includes("Balance due")) return "balance"
  if (input.body_snapshot?.includes("Payment received")) return "token_ack"
  if (input.body_snapshot?.includes("We've created a private WhatsApp group")) return "ride_group_guest"
  if (input.body_snapshot?.includes("We've created a WhatsApp group with the passenger")) return "ride_group_driver"
  if (input.body_snapshot?.includes("New ride assigned")) return "driver_assign"
  return null
}
