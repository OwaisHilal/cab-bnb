import { formatInr, TOKEN_LOCK_AMOUNT } from "@/lib/whatsapp/formatInr"
import { MSG91_PAYMENT_LINK_ITEM_NAME_MAX } from "@/lib/msg91/pure"
import { formatQuoteChoiceLine, formatQuoteChoiceTripSummary } from "@/lib/whatsapp/quoteChoiceTemplate"

export const TOKEN_LOCK_PAYMENT_TEMPLATE_KEY = "token_lock_payment_v1"
export const TOKEN_LOCK_PAYMENT_FOOTER = "Pay ₹99 to lock this cab."
export const TOKEN_PAY_PAYLOAD_PREFIX = "TOKEN_PAY::"
export const WHATSAPP_INTERACTIVE_BODY_MAX = 1024
export const TOKEN_LOCK_PAYMENT_MAX_DAY_LINES = 31

// Cashfree's dynamic Payment Links create-API (`POST /pg/links`) returns
// `link_creation_api is not enabled or approved` on this merchant account —
// a separate approval gate from the `s2s_enabled_not_approved` block on
// MSG91's `payment_link` interactive type. Neither is something our code can
// fix. Until Cashfree approves one of those APIs, every ₹99 token payment
// uses this single dashboard-created Payment Link, delivered as a plain
// WhatsApp CTA-URL button. See docs/cashfree-payment-links-workaround.md.
export const STATIC_TOKEN_PAYMENT_LINK_URL =
  "https://payments.cashfree.com/links/Cb0o4hnupupg_AAAAAAAVUJE"
export const TOKEN_PAY_BUTTON_TITLE = "Pay 99"

export interface TokenPaymentLinkTrip {
  tripDays: number
  paxCount: number
  vehicleLabel: string
  pickupLocation?: string | null
  dropLocation?: string | null
  tripStartDate?: string | null
}

export interface TokenPaymentLinkVendor {
  vendorName: string
  pricePerDay: number
  rating: number | null
}

export interface TokenPaymentLinkCopy {
  bodyText: string
  footerText: string
  itemName: string
  amountInr: number
  quantity: number
}

const parseTripStartDate = (value?: string | null): Date | null => {
  const raw = value?.trim()
  if (!raw) return null
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDate) {
    const year = Number(isoDate[1])
    const month = Number(isoDate[2])
    const day = Number(isoDate[3])
    const parsed = new Date(year, month - 1, day)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatDayLabel = (date: Date): string => {
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

export const formatTokenPaymentDayLines = (input: {
  tripDays: number
  tripStartDate?: string | null
}): string[] => {
  const days = clampTripDays(input.tripDays)
  const start = parseTripStartDate(input.tripStartDate)

  return Array.from({ length: days }, (_, index) => {
    if (!start) {
      return `Day ${index + 1}`
    }
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return `Day ${index + 1} · ${formatDayLabel(day)}`
  })
}

export const buildTokenLockItemName = (vendorName: string, tripDays: number): string => {
  const dayLabel = tripDays === 1 ? "1 day" : `${tripDays} days`
  const raw = `Token lock · ${vendorName.trim() || "Vendor"} · ${dayLabel}`
  return raw.slice(0, MSG91_PAYMENT_LINK_ITEM_NAME_MAX)
}

export const buildTokenPaymentLinkCopy = (input: {
  trip: TokenPaymentLinkTrip
  vendor: TokenPaymentLinkVendor
}): TokenPaymentLinkCopy => {
  const tripSummary = formatQuoteChoiceTripSummary(input.trip)
  const vendorLine = formatQuoteChoiceLine(input.vendor)
  const tripTotal = input.vendor.pricePerDay * input.trip.tripDays
  const balanceDue = Math.max(tripTotal - TOKEN_LOCK_AMOUNT, 0)
  const dayLines = formatTokenPaymentDayLines({
    tripDays: input.trip.tripDays,
    tripStartDate: input.trip.tripStartDate,
  })

  const bodyText = clampInteractiveBody(
    [
      "Lock this cab with a ₹99 token.",
      "",
      `Trip: ${tripSummary}`,
      vendorLine,
      `Total: ${formatInr(tripTotal)} · Token: ${formatInr(TOKEN_LOCK_AMOUNT)} · Balance: ${formatInr(balanceDue)}`,
      "",
      "Days",
      ...dayLines.map((line) => `• ${line}`),
    ].join("\n"),
  )

  return {
    bodyText,
    footerText: TOKEN_LOCK_PAYMENT_FOOTER,
    itemName: buildTokenLockItemName(input.vendor.vendorName, input.trip.tripDays),
    amountInr: TOKEN_LOCK_AMOUNT,
    quantity: 1,
  }
}

const clampTripDays = (value: number): number => {
  if (!Number.isFinite(value)) return 1
  return Math.min(TOKEN_LOCK_PAYMENT_MAX_DAY_LINES, Math.max(1, Math.floor(value)))
}

const clampInteractiveBody = (text: string): string => {
  if (text.length <= WHATSAPP_INTERACTIVE_BODY_MAX) return text
  return text.slice(0, WHATSAPP_INTERACTIVE_BODY_MAX)
}
