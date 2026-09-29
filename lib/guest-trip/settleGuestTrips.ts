import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  paymentHasPaidToken,
  paymentHasTakenMoney,
  pickCurrentGuestTrip,
  unpaidDuplicateTripIds,
  keeperStepForPayment,
} from "@/lib/guest-trip/pickCurrentGuestTrip"
import type { GuestTripCandidate } from "@/lib/guest-trip/types"

const isMissingRelation = (error: { code?: string; message: string }): boolean => {
  const code = error.code ?? ""
  const message = error.message.toLowerCase()
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  )
}

export const abandonUnpaidGuestTrips = async (
  supabase: SupabaseClient,
  tripIds: string[],
): Promise<void> => {
  for (const tripId of tripIds) {
    const { data: paidTokens, error: tokenError } = await supabase
      .from("whatsapp_payment_intents")
      .select("id")
      .eq("trip_request_id", tripId)
      .eq("purpose", "token_lock")
      .eq("status", "paid")
      .limit(1)

    if (tokenError && !isMissingRelation(tokenError)) {
      throw new Error(`Failed to recheck the token: ${tokenError.message}`)
    }
    if ((paidTokens ?? []).length > 0) continue

    const { data: bookings, error: bookingError } = await supabase
      .from("bookings")
      .select("payment_status")
      .eq("trip_request_id", tripId)

    if (bookingError) throw new Error(`Failed to recheck the booking: ${bookingError.message}`)
    if ((bookings ?? []).some((row) => paymentHasTakenMoney(row.payment_status as string))) continue

    const { error: abandonError } = await supabase
      .from("trip_requests")
      .update({ status: "abandoned" })
      .eq("id", tripId)
      .not("status", "in", "(abandoned,expired)")

    if (abandonError) throw new Error(`Failed to close the extra trip: ${abandonError.message}`)

    const { error: expireError } = await supabase
      .from("whatsapp_payment_intents")
      .update({ status: "expired" })
      .eq("trip_request_id", tripId)
      .in("status", ["pending", "sent"])

    if (expireError && !isMissingRelation(expireError)) {
      throw new Error(`Failed to expire payment intents: ${expireError.message}`)
    }
  }
}

export const resolveKeeperTripId = async (
  supabase: SupabaseClient,
  tripIds: string[],
): Promise<string | null> => {
  if (tripIds.length === 0) return null

  const { data: trips, error } = await supabase
    .from("trip_requests")
    .select("id, status, created_at")
    .in("id", tripIds)

  if (error) throw new Error(`Failed to fetch trips: ${error.message}`)
  if (!trips || trips.length === 0) return null

  const ids = trips.map((trip) => trip.id as string)
  const { data: bookings, error: bookingError } = await supabase
    .from("bookings")
    .select("trip_request_id, payment_status, driver_id, created_at")
    .in("trip_request_id", ids)
    .order("created_at", { ascending: false })

  if (bookingError) throw new Error(`Failed to fetch bookings: ${bookingError.message}`)

  const { data: intents, error: intentError } = await supabase
    .from("whatsapp_payment_intents")
    .select("trip_request_id, status, purpose")
    .in("trip_request_id", ids)
    .eq("purpose", "token_lock")
    .in("status", ["pending", "sent", "paid"])

  if (intentError && !isMissingRelation(intentError)) {
    throw new Error(`Failed to fetch payment intents: ${intentError.message}`)
  }

  const bookingByTrip = new Map<string, { payment_status: string; driver_id: string | null }>()
  for (const booking of bookings ?? []) {
    const tripRequestId = booking.trip_request_id as string
    if (!bookingByTrip.has(tripRequestId)) {
      bookingByTrip.set(tripRequestId, {
        payment_status: booking.payment_status as string,
        driver_id: (booking.driver_id as string | null) ?? null,
      })
    }
  }

  const tokenByTrip = new Map<string, string>()
  for (const intent of intentError ? [] : intents ?? []) {
    const tripRequestId = intent.trip_request_id as string
    if (!tokenByTrip.has(tripRequestId)) tokenByTrip.set(tripRequestId, intent.status as string)
  }

  const rows: GuestTripCandidate[] = trips.map((trip) => {
    const status = trip.status as string
    const booking = bookingByTrip.get(trip.id as string)
    const tokenStatus = tokenByTrip.get(trip.id as string) ?? null
    const paymentStatus = booking?.payment_status ?? null
    const step = keeperStepForPayment({
      tripRequestStatus: status,
      paymentStatus,
      tokenStatus,
      driverAssigned: Boolean(booking?.driver_id),
    })
    const closed = step === "closed"
    return {
      id: trip.id as string,
      createdAt: trip.created_at as string,
      inProgress: !closed && step !== "driver_contact",
      finished: step === "driver_contact",
      closed,
      step,
      hasPaidToken: paymentHasPaidToken(paymentStatus, tokenStatus),
      hasTakenMoney: paymentHasTakenMoney(paymentStatus) || tokenStatus === "paid",
    }
  })

  const keeper = pickCurrentGuestTrip(rows)
  if (!keeper) return null
  await abandonUnpaidGuestTrips(supabase, unpaidDuplicateTripIds(rows, keeper.id))
  return keeper.id
}
