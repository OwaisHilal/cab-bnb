import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface RecordReviewPayload {
  booking_id: string;
  rating: number;
}

/**
 * Checklist 3.10: records a `RATE_1..RATE_5` button reply. No dedicated
 * reviews table exists in the schema yet, so the rating is stored as the
 * `customer_response` on the booking's `post_trip_review`
 * `booking_lifecycle_events` row rather than inventing a new table for
 * this pass.
 */
export async function handleRecordReview(
  supabase: SupabaseClient,
  payload: RecordReviewPayload,
): Promise<void> {
  const { booking_id, rating } = payload;

  const { data: event, error: fetchError } = await supabase
    .from("booking_lifecycle_events")
    .select("id")
    .eq("booking_id", booking_id)
    .eq("event_type", "post_trip_review")
    .eq("status", "sent")
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to look up post_trip_review event: ${fetchError.message}`);

  if (!event) {
    // Nothing pending to respond to (duplicate webhook delivery, or the
    // review was already recorded) — succeed without retrying.
    console.warn(`[record-review] no pending post_trip_review event for booking ${booking_id}`);
    return;
  }

  const { error: updateError } = await supabase
    .from("booking_lifecycle_events")
    .update({ customer_response: String(rating), response_at: new Date().toISOString(), status: "responded" })
    .eq("id", event.id)
    .eq("status", "sent");

  if (updateError) throw new Error(`Failed to record review response: ${updateError.message}`);
}
