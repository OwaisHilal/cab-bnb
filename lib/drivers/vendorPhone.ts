import { phoneLast10 } from "@/lib/drivers/phone"

export const ACTIVE_VENDOR_BOOKING_STATUSES = [
  "vendor_confirming",
  "vendor_confirmed",
  "driver_attach_pending",
] as const

export const ATTACHED_OR_LATER_BOOKING_STATUSES = [
  "driver_attached",
  "ready_for_pickup",
  "in_trip",
  "completed",
] as const

export function vendorWhatsAppLookupValues(last10: string): string[] {
  const suffix = phoneLast10(last10)
  if (!suffix) return []
  return [`+91${suffix}`, `91${suffix}`, suffix, `+${suffix}`]
}

export function vendorWhatsAppOrFilter(last10: string): string {
  return vendorWhatsAppLookupValues(last10)
    .map((value) => `whatsapp_number.eq.${value}`)
    .join(",")
}

export function pickPreferredVendorBooking<T extends { status: string }>(rows: T[]): T | null {
  const waiting = rows.filter((row) =>
    (ACTIVE_VENDOR_BOOKING_STATUSES as readonly string[]).includes(row.status),
  )
  if (waiting[0]) return waiting[0]
  return rows[0] ?? null
}
