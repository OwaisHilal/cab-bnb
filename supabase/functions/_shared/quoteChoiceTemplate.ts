import type { Msg91TemplateComponent } from "./msg91WhatsApp.ts";

function formatInr(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`;
}

interface WhatsAppButton {
  id: string;
  title: string;
}


/**
 * First-contact Utility template after the tourist submits a phone number.
 *
 * MSG91 / Meta rules used here (docs.msg91.com + msg91.com/help/whatsapp):
 * - Cold start (typical after SMS OTP) must be a pre-approved Utility template,
 *   not a session interactive send.
 * - Quick-reply *titles* are static at approval: max 3 buttons, each ≤ 20 chars.
 * - Footer ≤ 60 chars. Body ≤ 1024 and must not start or end with a variable.
 * - Quick-reply titles are dynamic at send time: `Select {vendorName}` (≤ 20 chars).
 *   Meta/MSG91 Utility templates freeze QR titles at approval — live vendor names
 *   therefore go out on the session interactive path.
 * - Footer ≤ 60 chars. Body ≤ 1024 and must not start or end with a variable.
 * - Bulk send still fills `body_1`…`body_4` plus `button_N` payload overrides
 *   (`subtype: quick_reply`) so inbound parses as `BOOK_TOKEN::{quote_snapshot_id}`.
 */
export const QUOTE_CHOICE_TEMPLATE_KEY = "quote_choice_v1"
export const QUOTE_CHOICE_MAX_QUOTES = 3
export const QUOTE_CHOICE_FOOTER = "Tap a button below to choose your cab."
export const QUOTE_CHOICE_EMPTY_LINE = "—"
export const QUOTE_CHOICE_UNAVAILABLE_PAYLOAD = "UNAVAILABLE"
export const WHATSAPP_QUICK_REPLY_TITLE_MAX = 20
export const QUOTE_CHOICE_SELECT_PREFIX = "Select "
export const QUOTE_CHOICE_SAMPLE_VENDOR_NAMES = ["Aala Cabs", "Nova Cabs", "Valley Rides"] as const

export const QUOTE_CHOICE_BODY_NAMED = [
  "Your Kashmir cab quotes are in.",
  "",
  "Trip: {{trip_summary}}",
  "",
  "• {{quote_1}}",
  "• {{quote_2}}",
  "• {{quote_3}}",
  "",
  "Lowest price is listed first.",
].join("\n")

export const QUOTE_CHOICE_DASHBOARD_BODY = [
  "Your Kashmir cab quotes are in.",
  "",
  "Trip: {{1}}",
  "",
  "• {{2}}",
  "• {{3}}",
  "• {{4}}",
  "",
  "Lowest price is listed first.",
].join("\n")

export const QUOTE_CHOICE_SAMPLE_VARIABLES = {
  "1": "3 days · 4 pax · Sedan · Srinagar → Pahalgam",
  "2": "Aala Cabs ₹17,500/day (4.8)",
  "3": "Nova Cabs ₹18,000/day (4.6)",
  "4": "Valley Rides ₹18,400/day (4.5)",
} as const

export interface QuoteChoiceTripDetails {
  tripDays: number
  paxCount: number
  vehicleLabel: string
  pickupLocation?: string | null
  dropLocation?: string | null
}

export interface QuoteChoiceRow {
  quoteSnapshotId: string
  vendorName: string
  pricePerDay: number
  rating: number | null
}

export interface QuoteChoiceCreateApiBody {
  integrated_number: string
  template_name: string
  name: string
  language: string
  category: "UTILITY"
  components: Array<Record<string, unknown>>
}

export const formatVendorRating = (rating: number | null | undefined): string => {
  if (rating === null || rating === undefined || Number.isNaN(Number(rating))) {
    return "n/a"
  }
  return Number(rating).toFixed(1)
}

export const formatQuoteChoiceLine = (input: {
  vendorName: string
  pricePerDay: number
  rating: number | null
}): string => {
  const vendorName = input.vendorName.trim() || "Vendor"
  return `${vendorName} ${formatInr(input.pricePerDay)}/day (${formatVendorRating(input.rating)})`
}

export const formatQuoteChoiceTripSummary = (input: QuoteChoiceTripDetails): string => {
  const dayLabel = input.tripDays === 1 ? "day" : "days"
  const parts = [
    `${input.tripDays} ${dayLabel}`,
    `${input.paxCount} pax`,
    input.vehicleLabel.trim() || "Cab",
  ]
  const pickup = input.pickupLocation?.trim()
  const drop = input.dropLocation?.trim()
  if (pickup && drop) {
    parts.push(`${pickup} → ${drop}`)
  }
  return parts.join(" · ")
}

export const padQuoteChoiceRows = (rows: QuoteChoiceRow[]): Array<QuoteChoiceRow | null> => {
  const top = rows.slice(0, QUOTE_CHOICE_MAX_QUOTES)
  const padded: Array<QuoteChoiceRow | null> = [...top]
  while (padded.length < QUOTE_CHOICE_MAX_QUOTES) {
    padded.push(null)
  }
  return padded
}

export const quoteChoiceSelectTitle = (vendorName: string): string => {
  const name = vendorName.trim() || "vendor"
  const maxNameLen = WHATSAPP_QUICK_REPLY_TITLE_MAX - QUOTE_CHOICE_SELECT_PREFIX.length
  return `${QUOTE_CHOICE_SELECT_PREFIX}${name.slice(0, maxNameLen)}`
}

export const QUOTE_CHOICE_SAMPLE_BUTTON_TITLES = QUOTE_CHOICE_SAMPLE_VENDOR_NAMES.map(
  (name) => quoteChoiceSelectTitle(name),
)

export const buildQuoteChoiceButtons = (rows: QuoteChoiceRow[]): WhatsAppButton[] => {
  return padQuoteChoiceRows(rows).map((row) => ({
    id: row ? `BOOK_TOKEN::${row.quoteSnapshotId}` : QUOTE_CHOICE_UNAVAILABLE_PAYLOAD,
    title: quoteChoiceSelectTitle(row?.vendorName ?? "option"),
  }))
}

export const buildQuoteChoiceSessionButtons = (rows: QuoteChoiceRow[]): WhatsAppButton[] => {
  return rows.slice(0, QUOTE_CHOICE_MAX_QUOTES).map((row) => ({
    id: `BOOK_TOKEN::${row.quoteSnapshotId}`,
    title: quoteChoiceSelectTitle(row.vendorName),
  }))
}

export const buildQuoteChoiceMsg91Components = (input: {
  tripSummary: string
  rows: QuoteChoiceRow[]
}): Record<string, Msg91TemplateComponent> => {
  const padded = padQuoteChoiceRows(input.rows)
  const components: Record<string, Msg91TemplateComponent> = {
    body_1: { type: "text", value: input.tripSummary },
  }

  padded.forEach((row, index) => {
    const bodyKey = `body_${index + 2}`
    components[bodyKey] = {
      type: "text",
      value: row
        ? formatQuoteChoiceLine(row)
        : QUOTE_CHOICE_EMPTY_LINE,
    }
    const buttonKey = `button_${index + 1}`
    components[buttonKey] = {
      type: "text",
      subtype: "quick_reply",
      value: row ? `BOOK_TOKEN::${row.quoteSnapshotId}` : QUOTE_CHOICE_UNAVAILABLE_PAYLOAD,
    }
  })

  return components
}

export const buildQuoteChoiceNamedVariables = (input: {
  tripSummary: string
  rows: QuoteChoiceRow[]
}): Record<string, string> => {
  const padded = padQuoteChoiceRows(input.rows)
  return {
    trip_summary: input.tripSummary,
    quote_1: padded[0] ? formatQuoteChoiceLine(padded[0]) : QUOTE_CHOICE_EMPTY_LINE,
    quote_2: padded[1] ? formatQuoteChoiceLine(padded[1]) : QUOTE_CHOICE_EMPTY_LINE,
    quote_3: padded[2] ? formatQuoteChoiceLine(padded[2]) : QUOTE_CHOICE_EMPTY_LINE,
  }
}

/**
 * Facebook/WABA-shaped create body. MSG91's create-template docs point at
 * this component model (`POST /api/v5/whatsapp/client-panel-template/`)
 * but do not publish a full JSON example — persist the raw request and
 * map `template_name` / `language` / `category` / `components`.
 */
export const buildQuoteChoiceCreateApiBody = (
  integratedNumber: string,
): QuoteChoiceCreateApiBody => {
  return {
    integrated_number: integratedNumber.replace(/^\+/, ""),
    template_name: QUOTE_CHOICE_TEMPLATE_KEY,
    name: QUOTE_CHOICE_TEMPLATE_KEY,
    language: "en_US",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: QUOTE_CHOICE_DASHBOARD_BODY,
        example: {
          body_text: [
            [
              QUOTE_CHOICE_SAMPLE_VARIABLES["1"],
              QUOTE_CHOICE_SAMPLE_VARIABLES["2"],
              QUOTE_CHOICE_SAMPLE_VARIABLES["3"],
              QUOTE_CHOICE_SAMPLE_VARIABLES["4"],
            ],
          ],
        },
      },
      {
        type: "FOOTER",
        text: QUOTE_CHOICE_FOOTER,
      },
      {
        type: "BUTTONS",
        buttons: QUOTE_CHOICE_SAMPLE_BUTTON_TITLES.map((text) => ({
          type: "QUICK_REPLY",
          text,
        })),
      },
    ],
  }
}

export const isQuoteChoiceSelectTitle = (title: string): boolean => {
  const trimmed = title.trim()
  return (
    trimmed.startsWith(QUOTE_CHOICE_SELECT_PREFIX) &&
    trimmed.length <= WHATSAPP_QUICK_REPLY_TITLE_MAX
  )
}
