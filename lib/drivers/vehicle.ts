/**
 * Normalizes a vehicle registration number for lookup/storage so trivial
 * formatting differences (`jk01 ab 1234` vs `JK01AB1234` vs `jk01-ab-1234`)
 * don't create duplicate `vehicles` rows for the same physical vehicle.
 * Used by both the manual "Add new driver" form path
 * (lib/whatsapp/assignDriverToBooking.ts) and anywhere else a vendor types
 * a registration number free-hand.
 */
export const normalizeVehicleRegistration = (value: string): string => {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "")
}

/** Case/whitespace-insensitive name comparison — used to detect when a typed
 * driver name genuinely differs from a saved driver's name at the same
 * phone number, vs. just formatting differences. */
export const normalizeDriverName = (value: string): string => {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}
