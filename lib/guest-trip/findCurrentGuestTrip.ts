import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { isTripInProgress } from "@/lib/guest-trip/deriveGuestStep"
import { pickCurrentGuestTrip } from "@/lib/guest-trip/pickCurrentGuestTrip"

const CLOSED = new Set(["abandoned", "expired"])

export interface CurrentGuestTripRow {
  id: string
  createdAt: string
  inProgress: boolean
  finished: boolean
  closed: boolean
}

export const findCurrentGuestTrip = async (
  supabase: SupabaseClient,
  touristId: string,
): Promise<CurrentGuestTripRow | null> => {
  const { data: trips, error } = await supabase
    .from("trip_requests")
    .select("id, status, created_at")
    .eq("tourist_id", touristId)

  if (error) throw new Error(`Failed to fetch trips for phone: ${error.message}`)
  if (!trips || trips.length === 0) return null

  const ids = trips.map((trip) => trip.id as string)
  const { data: bookings, error: bookingError } = await supabase
    .from("bookings")
    .select("trip_request_id, payment_status, created_at")
    .in("trip_request_id", ids)
    .order("created_at", { ascending: false })

  if (bookingError) throw new Error(`Failed to fetch bookings for phone: ${bookingError.message}`)

  const paidByTrip = new Map<string, boolean>()
  for (const booking of bookings ?? []) {
    const tripRequestId = booking.trip_request_id as string
    if (!paidByTrip.has(tripRequestId)) {
      paidByTrip.set(tripRequestId, booking.payment_status === "fully_paid")
    }
  }

  const rows: CurrentGuestTripRow[] = trips.map((trip) => {
    const status = trip.status as string
    const closed = CLOSED.has(status)
    const balanceConfirmed = paidByTrip.get(trip.id as string) === true
    const inProgress = isTripInProgress({
      tripRequestStatus: status,
      quoteCount: 0,
      tokenIntentStatus: "none",
      driverAssigned: false,
      balanceIntentStatus: "none",
      balanceConfirmed,
    })
    return {
      id: trip.id as string,
      createdAt: trip.created_at as string,
      inProgress,
      finished: balanceConfirmed && !closed,
      closed,
    }
  })

  return pickCurrentGuestTrip(rows)
}

export const rememberGuestSession = async (
  supabase: SupabaseClient,
  sessionId: string,
  tripRequestId: string,
): Promise<void> => {
  const { error } = await supabase.from("guest_trip_sessions").upsert(
    { session_id: sessionId, trip_request_id: tripRequestId },
    { onConflict: "session_id" },
  )
  if (!error) return
  const message = error.message.toLowerCase()
  const code = error.code ?? ""
  if (code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")) {
    return
  }
  throw new Error(`Failed to save guest session: ${error.message}`)
}
