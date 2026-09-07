import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

const MIDTRIP_WELLNESS_MIN_DAYS_DEFAULT = 3

export const scheduleLifecycleEvents = async (
  supabase: SupabaseClient,
  bookingId: string,
  pickupAt: string,
  tripDays: number,
): Promise<void> => {
  const { count, error: countError } = await supabase
    .from("booking_lifecycle_events")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", bookingId)

  if (countError) throw new Error(`Failed to check existing lifecycle events: ${countError.message}`)
  if ((count ?? 0) > 0) return

  const pickupMs = new Date(pickupAt).getTime()
  const hour = 60 * 60 * 1000
  const day = 24 * hour
  const midtripMinDays = Number(process.env.MIDTRIP_WELLNESS_MIN_DAYS) || MIDTRIP_WELLNESS_MIN_DAYS_DEFAULT

  const events: Array<{ booking_id: string; event_type: string; scheduled_at: string }> = [
    {
      booking_id: bookingId,
      event_type: "pre_pickup_reminder",
      scheduled_at: new Date(pickupMs - 12 * hour).toISOString(),
    },
    {
      booking_id: bookingId,
      event_type: "day1_checkin",
      scheduled_at: new Date(pickupMs + 2 * hour).toISOString(),
    },
    {
      booking_id: bookingId,
      event_type: "post_trip_review",
      scheduled_at: new Date(pickupMs + tripDays * day + day).toISOString(),
    },
  ]

  if (tripDays >= midtripMinDays) {
    events.push({
      booking_id: bookingId,
      event_type: "midtrip_wellness",
      scheduled_at: new Date(pickupMs + 1.5 * day).toISOString(),
    })
  }

  const { error: insertError } = await supabase.from("booking_lifecycle_events").insert(events)
  if (insertError) throw new Error(`Failed to schedule lifecycle events: ${insertError.message}`)
}
