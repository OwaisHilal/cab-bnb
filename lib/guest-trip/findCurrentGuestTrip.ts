import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveKeeperTripId } from "@/lib/guest-trip/settleGuestTrips"

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

  const keeperId = await resolveKeeperTripId(
    supabase,
    trips.map((trip) => trip.id as string),
  )
  if (!keeperId) return null
  const trip = trips.find((row) => row.id === keeperId)
  return {
    id: keeperId,
    createdAt: (trip?.created_at as string | undefined) ?? new Date(0).toISOString(),
    inProgress: false,
    finished: true,
    closed: false,
  }
}

export const rememberGuestSession = async (
  supabase: SupabaseClient,
  sessionId: string,
  tripRequestId: string,
): Promise<boolean> => {
  const { error } = await supabase.from("guest_trip_sessions").upsert(
    { session_id: sessionId, trip_request_id: tripRequestId },
    { onConflict: "session_id" },
  )
  if (!error) return true
  const message = error.message.toLowerCase()
  const code = error.code ?? ""
  if (code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")) {
    return false
  }
  throw new Error(`Failed to save guest session: ${error.message}`)
}
