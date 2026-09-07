import { MSG91_PAYMENT_LINK_ITEM_NAME_MAX } from "@/lib/msg91/pure"
import { formatInr, TOKEN_LOCK_AMOUNT } from "@/lib/whatsapp/formatInr"
import { formatQuoteChoiceLine, formatQuoteChoiceTripSummary } from "@/lib/whatsapp/quoteChoiceTemplate"

export const DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY = "driver_assigned_payment_v1"
export const DRIVER_ASSIGNED_PAYMENT_FOOTER = "Pay remaining balance to confirm."
export const BALANCE_PAY_PAYLOAD_PREFIX = "BALANCE_PAY::"
export const WHATSAPP_INTERACTIVE_BODY_MAX = 1024

export interface BalancePaymentLinkCopy {
  bodyText: string
  footerText: string
  itemName: string
  amountInr: number
  quantity: number
}

const clampInteractiveBody = (text: string): string => {
  if (text.length <= WHATSAPP_INTERACTIVE_BODY_MAX) return text
  return text.slice(0, WHATSAPP_INTERACTIVE_BODY_MAX)
}

export const calculateBalanceDue = (finalQuote: number, tripDays: number): number => {
  return Math.max(finalQuote * tripDays - TOKEN_LOCK_AMOUNT, 0)
}

export const buildBalanceItemName = (vendorName: string, tripDays: number): string => {
  const dayLabel = tripDays === 1 ? "1 day" : `${tripDays} days`
  const raw = `Balance · ${vendorName.trim() || "Vendor"} · ${dayLabel}`
  return raw.slice(0, MSG91_PAYMENT_LINK_ITEM_NAME_MAX)
}

export const buildBalancePaymentLinkCopy = (input: {
  tripDays: number
  paxCount: number
  vehicleLabel: string
  pickupLocation?: string | null
  dropLocation?: string | null
  vendorName: string
  pricePerDay: number
  rating: number | null
  driverName: string
  vehicleModel: string
  vehicleNumber: string
  balanceDue: number
}): BalancePaymentLinkCopy => {
  const tripSummary = formatQuoteChoiceTripSummary({
    tripDays: input.tripDays,
    paxCount: input.paxCount,
    vehicleLabel: input.vehicleLabel,
    pickupLocation: input.pickupLocation,
    dropLocation: input.dropLocation,
  })
  const vendorLine = formatQuoteChoiceLine({
    vendorName: input.vendorName,
    pricePerDay: input.pricePerDay,
    rating: input.rating,
  })
  const tripTotal = input.pricePerDay * input.tripDays
  const vehicleLine = `${input.vehicleModel} (${input.vehicleNumber})`

  const bodyText = clampInteractiveBody(
    [
      "Your driver has been assigned.",
      "",
      `Trip: ${tripSummary}`,
      vendorLine,
      `Driver: ${input.driverName} · ${vehicleLine}`,
      `Total: ${formatInr(tripTotal)} · Token paid: ${formatInr(TOKEN_LOCK_AMOUNT)} · Balance: ${formatInr(input.balanceDue)}`,
    ].join("\n"),
  )

  const footer = DRIVER_ASSIGNED_PAYMENT_FOOTER.slice(0, 60)

  return {
    bodyText,
    footerText: footer,
    itemName: buildBalanceItemName(input.vendorName, input.tripDays),
    amountInr: input.balanceDue,
    quantity: 1,
  }
}
