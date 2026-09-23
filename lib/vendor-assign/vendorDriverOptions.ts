import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { isMissingFleet } from "@/lib/whatsapp/assignDriverToBooking"

/**
 * One row in the vendor's saved-driver picker on app/vendor/assign-driver.
 * Deliberately excludes photo bytes/URLs beyond an availability boolean —
 * the form only needs to say "car photo on file" or not, never fetch or
 * render the image itself. Keeps the page light inside WhatsApp's
 * in-app browser (see docs/2026-09-23-vendor-assign-ux.md, performance
 * section).
 */
export interface VendorDriverOption {
  driverId: string
  fullName: string
  phoneLast10: string
  hasDriverPhoto: boolean
  primaryVehicleId: string | null
  registrationNumber: string | null
  model: string | null
  vehicleTypeId: number | null
  hasVehiclePhoto: boolean
  /** Precomputed lowercase blob (name + phone suffix + reg + model) so the
   * client can filter with one substring check per keystroke instead of
   * re-deriving this on every render. */
  searchText: string
}

/** This page opens inside WhatsApp's in-app browser — keep the roster
 * payload small regardless of how large a vendor's fleet grows. */
const MAX_ROSTER_SIZE = 100

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

interface EmbeddedVehicle {
  id: string
  registration_number: string | null
  model: string | null
  vehicle_type_id: number | null
  stock_photo_url: string | null
}

interface EmbeddedDriverVehicleLink {
  vehicle_id: string
  is_primary: boolean
  vehicles: EmbeddedVehicle | EmbeddedVehicle[] | null
}

/**
 * Loads the vendor's active drivers, each with its primary vehicle (if
 * any), in one bounded, column-scoped query — powers the "Choose existing
 * driver" flow on app/vendor/assign-driver/page.tsx. Never fetches image
 * bytes, only availability booleans. Run this alongside (not after) the
 * booking-summary load, e.g. via `Promise.all`, so the roster query isn't
 * an extra sequential round-trip before the page can render.
 */
export const loadVendorDriverOptions = async (
  supabase: SupabaseClient,
  vendorId: string,
): Promise<VendorDriverOption[]> => {
  const { data, error } = await supabase
    .from("drivers")
    .select(
      "id, full_name, phone_last10, photo_url, driver_vehicle_links(vehicle_id, is_primary, vehicles(id, registration_number, model, vehicle_type_id, stock_photo_url))",
    )
    .eq("vendor_id", vendorId)
    .eq("status", "active")
    .order("full_name", { ascending: true })
    .limit(MAX_ROSTER_SIZE)

  if (error) {
    if (isMissingFleet(error)) return []
    throw new Error(`Failed to load vendor drivers: ${error.message}`)
  }

  return (data ?? []).map((row) => {
    const rawLinks = row.driver_vehicle_links as EmbeddedDriverVehicleLink | EmbeddedDriverVehicleLink[] | null
    const links = Array.isArray(rawLinks) ? rawLinks : rawLinks ? [rawLinks] : []
    const primaryLink = links.find((link) => link.is_primary) ?? links[0] ?? null
    const vehicle = firstOrSelf(primaryLink?.vehicles ?? null)

    const fullName = ((row.full_name as string | null) ?? "").trim()
    const phoneLast10 = (row.phone_last10 as string | null) ?? ""
    const registrationNumber = vehicle?.registration_number ?? null
    const model = vehicle?.model ?? null

    return {
      driverId: row.id as string,
      fullName,
      phoneLast10,
      hasDriverPhoto: Boolean(((row.photo_url as string | null) ?? "").trim()),
      primaryVehicleId: (primaryLink?.vehicle_id as string | undefined) ?? null,
      registrationNumber,
      model,
      vehicleTypeId: vehicle?.vehicle_type_id ?? null,
      hasVehiclePhoto: Boolean((vehicle?.stock_photo_url ?? "").trim()),
      searchText: [fullName, phoneLast10, registrationNumber, model].filter(Boolean).join(" ").toLowerCase(),
    }
  })
}

/**
 * Pure re-sort: puts drivers whose primary vehicle type matches the
 * booking's requested vehicle type first (most likely pick for this ride),
 * keeping the server's alphabetical order as a stable secondary sort. Kept
 * separate from the Supabase query so it's independently testable and so
 * page.tsx can apply it only once the booking's `vehicleTypeId` is known
 * (which the roster query itself doesn't need to run in parallel).
 */
export const sortVendorDriverOptionsByPreferredVehicleType = (
  options: VendorDriverOption[],
  preferredVehicleTypeId: number | null,
): VendorDriverOption[] => {
  if (preferredVehicleTypeId == null) return options
  return [...options].sort((a, b) => {
    const aMatch = a.vehicleTypeId === preferredVehicleTypeId ? 0 : 1
    const bMatch = b.vehicleTypeId === preferredVehicleTypeId ? 0 : 1
    return aMatch - bMatch
  })
}
