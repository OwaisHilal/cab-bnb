import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AdminDebugBooking, AdminDebugFeed, AdminDebugTripRequest } from "@/features/admin-debug/types"
import { loadWhatsAppDebugFeed } from "@/lib/admin/loadWhatsAppDebugFeed"

const DEFAULT_LIMIT = 50

interface TouristRow {
  phone_e164: string
  full_name: string | null
}

interface VehicleTypeRow {
  label: string
}

interface VendorRow {
  business_name: string
}

interface QuoteSnapshotRow {
  id: string
  current_quote: number
  is_best_price: boolean
  status: string
  vendors: VendorRow | VendorRow[] | null
}

interface TripRequestRow {
  id: string
  session_id: string
  status: string
  trip_start_date: string
  trip_days: number
  pax_count: number
  recommendation_reason: string | null
  created_at: string
  updated_at: string
  tourist: TouristRow | TouristRow[] | null
  requested_vehicle_type: VehicleTypeRow | VehicleTypeRow[] | null
  quote_snapshots: QuoteSnapshotRow[] | null
}

interface BookingRow {
  id: string
  booking_ref: string
  status: string
  payment_status: string
  final_quote: number | null
  trip_days: number
  pax_count: number
  created_at: string
  tourist: TouristRow | TouristRow[] | null
  vendor: VendorRow | VendorRow[] | null
  vehicle_type: VehicleTypeRow | VehicleTypeRow[] | null
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function formatTripRequests(rows: TripRequestRow[]): AdminDebugTripRequest[] {
  return rows.map((row) => {
    const tourist = firstOrSelf(row.tourist)
    const requestedVehicleType = firstOrSelf(row.requested_vehicle_type)
    const quotes = (row.quote_snapshots ?? []).map((quote) => ({
      id: quote.id,
      vendor_name: firstOrSelf(quote.vendors)?.business_name ?? "Vendor",
      current_quote: quote.current_quote,
      is_best_price: quote.is_best_price,
      status: quote.status,
    }))
    const bestQuote = quotes.reduce<number | null>((best, quote) => {
      if (best === null || quote.current_quote < best) return quote.current_quote
      return best
    }, null)

    return {
      id: row.id,
      session_id: row.session_id,
      status: row.status,
      trip_start_date: row.trip_start_date,
      trip_days: row.trip_days,
      pax_count: row.pax_count,
      tourist_phone: tourist?.phone_e164 ?? null,
      tourist_name: tourist?.full_name ?? null,
      requested_vehicle_type_label: requestedVehicleType?.label ?? null,
      recommendation_reason: row.recommendation_reason,
      quote_count: quotes.length,
      best_quote: bestQuote,
      created_at: row.created_at,
      updated_at: row.updated_at,
      quotes,
    }
  })
}

function formatBookings(rows: BookingRow[]): AdminDebugBooking[] {
  return rows.map((row) => {
    const tourist = firstOrSelf(row.tourist)
    const vendor = firstOrSelf(row.vendor)
    const vehicleType = firstOrSelf(row.vehicle_type)

    return {
      id: row.id,
      booking_ref: row.booking_ref,
      status: row.status,
      payment_status: row.payment_status,
      final_quote: row.final_quote,
      tourist_phone: tourist?.phone_e164 ?? null,
      vendor_name: vendor?.business_name ?? null,
      vehicle_type_label: vehicleType?.label ?? null,
      trip_days: row.trip_days,
      pax_count: row.pax_count,
      created_at: row.created_at,
    }
  })
}

export async function loadDebugFeed(supabase: SupabaseClient): Promise<AdminDebugFeed> {
  const [tripResult, bookingResult, whatsapp] = await Promise.all([
    supabase
      .from("trip_requests")
      .select(
        "id, session_id, status, trip_start_date, trip_days, pax_count, recommendation_reason, created_at, updated_at, " +
          "tourist:tourists(phone_e164, full_name), " +
          "requested_vehicle_type:vehicle_types!trip_requests_requested_vehicle_type_id_fkey(label), " +
          "quote_snapshots(id, current_quote, is_best_price, status, vendors(business_name))",
      )
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    supabase
      .from("bookings")
      .select(
        "id, booking_ref, status, payment_status, final_quote, trip_days, pax_count, created_at, " +
          "tourist:tourists(phone_e164, full_name), " +
          "vendor:vendors(business_name), " +
          "vehicle_type:vehicle_types(label)",
      )
      .order("created_at", { ascending: false })
      .limit(DEFAULT_LIMIT),
    loadWhatsAppDebugFeed(supabase),
  ])

  if (tripResult.error) {
    throw new Error(`Failed to fetch trip requests: ${tripResult.error.message}`)
  }
  if (bookingResult.error) {
    throw new Error(`Failed to fetch bookings: ${bookingResult.error.message}`)
  }

  return {
    fetched_at: new Date().toISOString(),
    trip_requests: formatTripRequests((tripResult.data ?? []) as unknown as TripRequestRow[]),
    bookings: formatBookings((bookingResult.data ?? []) as unknown as BookingRow[]),
    whatsapp,
  }
}
