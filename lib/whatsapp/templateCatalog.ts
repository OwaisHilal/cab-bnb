/**
 * WhatsApp message builders — copy comes from `whatsapp_message_templates` in DB
 * (loaded via messageTemplateStore). Inline fallbacks exist when migration not applied.
 */

import { formatInr, TOKEN_LOCK_AMOUNT } from "@/lib/whatsapp/formatInr"
import type { Msg91TemplateComponent } from "@/lib/msg91/types"
import {
  getMessageTemplate,
  renderMessageTemplate,
  type WhatsAppMessageTemplateRow,
} from "@/lib/whatsapp/messageTemplateStore"
import {
  QUOTE_CHOICE_FOOTER,
  buildQuoteChoiceMsg91Components,
  buildQuoteChoiceNamedVariables,
  buildQuoteChoiceSessionButtons,
  formatQuoteChoiceTripSummary,
  type QuoteChoiceRow,
  type QuoteChoiceTripDetails,
} from "@/lib/whatsapp/quoteChoiceTemplate"
import { WHATSAPP_TEMPLATE_KEYS, type WhatsAppTemplateKey } from "@/lib/whatsapp/templateKeys"
import type { WhatsAppButton, WhatsAppMessageSpec } from "@/lib/whatsapp/types"

export { WHATSAPP_TEMPLATE_KEYS, type WhatsAppTemplateKey }

function requireTemplate(templateKey: string): WhatsAppMessageTemplateRow {
  const row = getMessageTemplate(templateKey)
  if (!row) {
    throw new Error(`WhatsApp template not found: ${templateKey}`)
  }
  return row
}

function formatPickupDate(pickupAt: string): string {
  return new Date(pickupAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

function tripDateVariables(pickupAt: string, tripDays: number): Record<string, string> {
  return {
    pickup_date: formatPickupDate(pickupAt),
    trip_days: String(tripDays),
    day_label: tripDays > 1 ? "days" : "day",
  }
}

/** Dashboard registration bodies — prefers DB `dashboard_body`, falls back to inline. */
export const MSG91_DASHBOARD_BODIES: Partial<Record<WhatsAppTemplateKey, string>> = {
  [WHATSAPP_TEMPLATE_KEYS.QUOTE_SINGLE]:
    "Your Kashmir Cab Quote \ud83d\ude96\n\n{{1}}: \u20b9{{2}}/day ({{3}})",
  [WHATSAPP_TEMPLATE_KEYS.QUOTE_MULTI]:
    "Your Kashmir Cab Quotes Are In \ud83d\ude96\n\n{{1}}",
  [WHATSAPP_TEMPLATE_KEYS.QUOTE_CHOICE]:
    "Your Kashmir cab quotes are in.\n\nTrip: {{1}}\n\n• {{2}}\n• {{3}}\n• {{4}}\n\nLowest price is listed first.",
  [WHATSAPP_TEMPLATE_KEYS.DRIVER_BALANCE]:
    "Your driver has been assigned \ud83d\ude97\nOperator: {{1}}\nBalance due: \u20b9{{2}} (after \u20b999 token).\nComplete payment here to unlock your driver's contact number.",
  [WHATSAPP_TEMPLATE_KEYS.DRIVER_CONTACT]:
    "Payment received \u2705\nYour driver: {{1}}\nCall / WhatsApp: {{2}}\nVehicle: {{3}} ({{4}})\nOperator: {{5}}\nDriver will reach out before pickup. Safe travels!",
}

export function resolveMsg91DashboardBody(templateKey: string): string | null {
  const row = getMessageTemplate(templateKey)
  if (row?.dashboard_body) return row.dashboard_body
  return MSG91_DASHBOARD_BODIES[templateKey as WhatsAppTemplateKey] ?? null
}

export const MSG91_DASHBOARD_BUTTONS = {
  [WHATSAPP_TEMPLATE_KEYS.QUOTE_SINGLE]: ["Pay \u20b999 to Lock"],
  [WHATSAPP_TEMPLATE_KEYS.QUOTE_CHOICE]: ["Select {{vendor_1}}", "Select {{vendor_2}}", "Select {{vendor_3}}"],
  [WHATSAPP_TEMPLATE_KEYS.DRIVER_BALANCE]: ["Pay balance Now"],
} as const

function bookTokenButton(quoteSnapshotId: string): WhatsAppButton {
  return { id: `BOOK_TOKEN::${quoteSnapshotId}`, title: "Pay \u20b999 to Lock" }
}

function completePaymentButton(bookingId: string, balanceDue: number): WhatsAppButton {
  return { id: `COMPLETE_PAYMENT::${bookingId}`, title: `Pay ${formatInr(balanceDue)} Now` }
}

function buildListFromTemplate(
  template: WhatsAppMessageTemplateRow,
  rows: Array<{ id: string; title: string; description: string }>,
) {
  const config = template.list_config ?? {}
  return {
    buttonText: config.buttonText ?? "Choose operator",
    sections: [
      {
        title: config.sectionTitle ?? "Pay \u20b999 to lock",
        rows,
      },
    ],
  }
}

export function buildQuoteSingleMessage(input: {
  vendorName: string
  pricePerDay: number
  vehicleLabel: string
  quoteSnapshotId: string
}): WhatsAppMessageSpec {
  const template = requireTemplate(WHATSAPP_TEMPLATE_KEYS.QUOTE_SINGLE)
  const pricePerDay = `${formatInr(input.pricePerDay)}/day`
  const bodyText = renderMessageTemplate(template.body_template, {
    vendor_name: input.vendorName,
    price_per_day: pricePerDay,
    vehicle_label: input.vehicleLabel,
  })

  const components: Record<string, Msg91TemplateComponent> = {
    body_1: { type: "text", value: input.vendorName },
    body_2: { type: "text", value: String(input.pricePerDay) },
    body_3: { type: "text", value: input.vehicleLabel },
  }

  return {
    templateKey: WHATSAPP_TEMPLATE_KEYS.QUOTE_SINGLE,
    bodyText,
    buttons: [],
    list: buildListFromTemplate(template, [
      {
        id: `BOOK_TOKEN::${input.quoteSnapshotId}`,
        title: input.vendorName,
        description: `${pricePerDay} \u00b7 ${input.vehicleLabel}`,
      },
    ]),
    msg91Components: components,
    msg91SendMode: "interactive",
  }
}

export function buildQuoteMultiMessage(input: {
  quoteLines: string[]
  bestQuoteSnapshotId: string
  quoteRows?: Array<{ quoteSnapshotId: string; vendorName: string; pricePerDay: number; vehicleLabel: string }>
}): WhatsAppMessageSpec {
  const template = requireTemplate(WHATSAPP_TEMPLATE_KEYS.QUOTE_MULTI)
  const joinedLines = input.quoteLines.join("\n")
  const bodyText = renderMessageTemplate(template.body_template, {
    quote_lines: joinedLines,
  })

  if (input.quoteRows && input.quoteRows.length > 0) {
    return {
      templateKey: WHATSAPP_TEMPLATE_KEYS.QUOTE_MULTI,
      bodyText,
      buttons: [],
      list: buildListFromTemplate(
        template,
        input.quoteRows.slice(0, 10).map((row) => ({
          id: `BOOK_TOKEN::${row.quoteSnapshotId}`,
          title: row.vendorName,
          description: `${formatInr(row.pricePerDay)}/day \u00b7 ${row.vehicleLabel}`,
        })),
      ),
      msg91Components: {
        body_1: { type: "text", value: joinedLines },
      },
      msg91SendMode: "interactive",
    }
  }

  return {
    templateKey: WHATSAPP_TEMPLATE_KEYS.QUOTE_MULTI,
    bodyText,
    buttons: [bookTokenButton(input.bestQuoteSnapshotId)],
    msg91Components: {
      body_1: { type: "text", value: joinedLines },
    },
    msg91SendMode: "interactive",
  }
}

export function buildQuoteChoiceMessage(input: {
  trip: QuoteChoiceTripDetails
  quotes: QuoteChoiceRow[]
}): WhatsAppMessageSpec {
  const template = requireTemplate(WHATSAPP_TEMPLATE_KEYS.QUOTE_CHOICE)
  const quotes = input.quotes.slice(0, 3)
  const tripSummary = formatQuoteChoiceTripSummary(input.trip)
  const named = buildQuoteChoiceNamedVariables({ tripSummary, rows: quotes })
  const bodyText = renderMessageTemplate(template.body_template, named)
  const footerText = template.footer_template?.trim() || QUOTE_CHOICE_FOOTER

  return {
    templateKey: WHATSAPP_TEMPLATE_KEYS.QUOTE_CHOICE,
    bodyText,
    footerText,
    buttons: buildQuoteChoiceSessionButtons(quotes),
    msg91Components: buildQuoteChoiceMsg91Components({ tripSummary, rows: quotes }),
    msg91SendMode: "interactive",
  }
}

export function buildDriverBalanceMessage(input: {
  vendorName: string
  balanceDue: number
  bookingId: string
  driverName: string
  vehicleModel: string
  vehicleNumber: string
}): WhatsAppMessageSpec {
  const template = requireTemplate(WHATSAPP_TEMPLATE_KEYS.DRIVER_BALANCE)
  const bodyText = renderMessageTemplate(template.body_template, {
    vendor_name: input.vendorName,
    balance_due: formatInr(input.balanceDue),
  })

  return {
    templateKey: WHATSAPP_TEMPLATE_KEYS.DRIVER_BALANCE,
    bodyText,
    buttons: [completePaymentButton(input.bookingId, input.balanceDue)],
    msg91Components: {
      body_1: { type: "text", value: input.vendorName },
      body_2: { type: "text", value: String(input.balanceDue) },
    },
    msg91SendMode: "interactive",
    mediaMeta: {
      driverName: input.driverName,
      vehicleModel: input.vehicleModel,
      vehicleNumber: input.vehicleNumber,
    },
  }
}

export function buildDriverContactMessage(input: {
  driverName: string
  driverPhone: string
  vehicleModel: string
  vehicleNumber: string
  vendorName: string
}): WhatsAppMessageSpec {
  const template = requireTemplate(WHATSAPP_TEMPLATE_KEYS.DRIVER_CONTACT)
  const bodyText = renderMessageTemplate(template.body_template, {
    driver_name: input.driverName,
    driver_phone: input.driverPhone,
    vehicle_model: input.vehicleModel,
    vehicle_number: input.vehicleNumber,
    vendor_name: input.vendorName,
  })

  return {
    templateKey: WHATSAPP_TEMPLATE_KEYS.DRIVER_CONTACT,
    bodyText,
    buttons: [],
    msg91Components: {
      body_1: { type: "text", value: input.driverName },
      body_2: { type: "text", value: input.driverPhone },
      body_3: { type: "text", value: input.vehicleModel },
      body_4: { type: "text", value: input.vehicleNumber },
      body_5: { type: "text", value: input.vendorName },
    },
    msg91SendMode: "text",
    mediaMeta: {
      driverName: input.driverName,
      vehicleModel: input.vehicleModel,
      vehicleNumber: input.vehicleNumber,
    },
  }
}

export function buildDriverAssignmentMessage(input: {
  driverName: string
  pickupLocation: string
  dropLocation: string
  pickupAt: string
  tripDays: number
  guestPhone: string
  guestName: string | null
  vehicleModel: string
  vehicleNumber: string
}): string {
  const template = requireTemplate("driver_assignment_v1")
  return renderMessageTemplate(template.body_template, {
    driver_name: input.driverName,
    pickup: input.pickupLocation,
    drop: input.dropLocation,
    guest_name: input.guestName ?? "Guest",
    guest_phone: input.guestPhone,
    vehicle_model: input.vehicleModel,
    vehicle_number: input.vehicleNumber,
    ...tripDateVariables(input.pickupAt, input.tripDays),
  })
}

export function buildVendorNotificationMessage(input: {
  pickupLocation: string
  dropLocation: string
  pickupAt: string
  tripDays: number
  paxCount: number
  vehicleLabel: string
  finalQuotePerDay: number
}): string {
  const template = requireTemplate("vendor_booking_notify_v1")
  return renderMessageTemplate(template.body_template, {
    pickup: input.pickupLocation,
    drop: input.dropLocation,
    pax_count: String(input.paxCount),
    vehicle_label: input.vehicleLabel,
    final_quote: formatInr(input.finalQuotePerDay),
    ...tripDateVariables(input.pickupAt, input.tripDays),
  })
}

export function buildVendorNotificationDemoMessage(input: {
  vendorName: string
  guestName: string | null
  guestPhone: string
  pickupLocation: string
  dropLocation: string
  pickupAt: string
  tripDays: number
  paxCount: number
  vehicleLabel: string
  finalQuotePerDay: number
}): string {
  const template = requireTemplate("vendor_booking_notify_demo")
  return renderMessageTemplate(template.body_template, {
    vendor_name: input.vendorName,
    guest_name: input.guestName ?? "Guest",
    guest_phone: input.guestPhone,
    pickup: input.pickupLocation,
    drop: input.dropLocation,
    pax_count: String(input.paxCount),
    vehicle_label: input.vehicleLabel,
    final_quote: formatInr(input.finalQuotePerDay),
    ...tripDateVariables(input.pickupAt, input.tripDays),
  })
}

export function parseDriverMetaFromBody(body: string | null): {
  name: string | null
  vehicle: string | null
} {
  if (!body) return { name: null, vehicle: null }
  const name =
    body.match(/^Driver: (.+)$/m)?.[1] ??
    body.match(/^Your driver: (.+)$/m)?.[1] ??
    null
  const vehicle = body.match(/^Vehicle: (.+)$/m)?.[1] ?? null
  return { name, vehicle }
}

export function resolveDriverMediaMeta(
  spec: WhatsAppMessageSpec,
  body: string | null,
): { driverName: string; vehicleLabel: string } | null {
  if (spec.mediaMeta) {
    return {
      driverName: spec.mediaMeta.driverName,
      vehicleLabel: `${spec.mediaMeta.vehicleModel} (${spec.mediaMeta.vehicleNumber})`,
    }
  }
  const parsed = parseDriverMetaFromBody(body)
  if (!parsed.name) return null
  return {
    driverName: parsed.name,
    vehicleLabel: parsed.vehicle ?? "Vehicle",
  }
}
