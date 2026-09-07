function formatInr(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`;
}

export const TOKEN_LOCK_AMOUNT = 99;
export const TOKEN_LOCK_PAYMENT_TEMPLATE_KEY = "token_lock_payment_v1";
export const TOKEN_LOCK_PAYMENT_FOOTER = "Pay ₹99 to lock this cab.";
export const TOKEN_PAY_PAYLOAD_PREFIX = "TOKEN_PAY::";
export const MSG91_PAYMENT_LINK_ITEM_NAME_MAX = 60;
export const WHATSAPP_INTERACTIVE_BODY_MAX = 1024;
export const TOKEN_LOCK_PAYMENT_MAX_DAY_LINES = 31;

export interface TokenPaymentLinkTrip {
  tripDays: number;
  paxCount: number;
  vehicleLabel: string;
  pickupLocation?: string | null;
  dropLocation?: string | null;
  tripStartDate?: string | null;
}

export interface TokenPaymentLinkVendor {
  vendorName: string;
  pricePerDay: number;
  rating: number | null;
}

function formatVendorRating(rating: number | null | undefined): string {
  if (rating === null || rating === undefined || Number.isNaN(Number(rating))) {
    return "n/a";
  }
  return Number(rating).toFixed(1);
}

function formatTripSummary(input: TokenPaymentLinkTrip): string {
  const dayLabel = input.tripDays === 1 ? "day" : "days";
  const parts = [
    `${input.tripDays} ${dayLabel}`,
    `${input.paxCount} pax`,
    input.vehicleLabel.trim() || "Cab",
  ];
  const pickup = input.pickupLocation?.trim();
  const drop = input.dropLocation?.trim();
  if (pickup && drop) {
    parts.push(`${pickup} → ${drop}`);
  }
  return parts.join(" · ");
}

function parseTripStartDate(value?: string | null): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function formatTokenPaymentDayLines(input: {
  tripDays: number;
  tripStartDate?: string | null;
}): string[] {
  const days = clampTripDays(input.tripDays);
  const start = parseTripStartDate(input.tripStartDate);

  return Array.from({ length: days }, (_, index) => {
    if (!start) {
      return `Day ${index + 1}`;
    }
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return `Day ${index + 1} · ${formatDayLabel(day)}`;
  });
}

export function buildTokenLockItemName(vendorName: string, tripDays: number): string {
  const dayLabel = tripDays === 1 ? "1 day" : `${tripDays} days`;
  const raw = `Token lock · ${vendorName.trim() || "Vendor"} · ${dayLabel}`;
  return raw.slice(0, MSG91_PAYMENT_LINK_ITEM_NAME_MAX);
}

export function buildTokenPaymentLinkCopy(input: {
  trip: TokenPaymentLinkTrip;
  vendor: TokenPaymentLinkVendor;
}): {
  bodyText: string;
  footerText: string;
  itemName: string;
  amountInr: number;
  quantity: number;
} {
  const tripSummary = formatTripSummary(input.trip);
  const vendorLine = `${input.vendor.vendorName.trim() || "Vendor"} ${formatInr(input.vendor.pricePerDay)}/day (${formatVendorRating(input.vendor.rating)})`;
  const tripTotal = input.vendor.pricePerDay * input.trip.tripDays;
  const balanceDue = Math.max(tripTotal - TOKEN_LOCK_AMOUNT, 0);
  const dayLines = formatTokenPaymentDayLines({
    tripDays: input.trip.tripDays,
    tripStartDate: input.trip.tripStartDate,
  });

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
  );

  return {
    bodyText,
    footerText: TOKEN_LOCK_PAYMENT_FOOTER,
    itemName: buildTokenLockItemName(input.vendor.vendorName, input.trip.tripDays),
    amountInr: TOKEN_LOCK_AMOUNT,
    quantity: 1,
  };
}

function clampTripDays(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(TOKEN_LOCK_PAYMENT_MAX_DAY_LINES, Math.max(1, Math.floor(value)));
}

function clampInteractiveBody(text: string): string {
  if (text.length <= WHATSAPP_INTERACTIVE_BODY_MAX) return text;
  return text.slice(0, WHATSAPP_INTERACTIVE_BODY_MAX);
}
