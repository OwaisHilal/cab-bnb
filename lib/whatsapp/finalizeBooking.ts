import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

const enqueueAckIfMissing = async (supabase: SupabaseClient, bookingId: string): Promise<void> => {
  const { data: existing, error } = await supabase
    .from("job_queue")
    .select("id")
    .eq("job_type", "send_token_received_ack")
    .contains("payload", { booking_id: bookingId })
    .in("status", ["queued", "processing", "done"])
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to check token ack job: ${error.message}`)
  if (existing?.id) return

  const { error: insertError } = await supabase.from("job_queue").insert({
    job_type: "send_token_received_ack",
    payload: { booking_id: bookingId },
  })
  if (insertError) throw new Error(`Failed to enqueue send_token_received_ack: ${insertError.message}`)
}

const lookupBookingId = async (
  supabase: SupabaseClient,
  quoteSnapshotId: string,
): Promise<string | null> => {
  const { data, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("winning_quote_snapshot_id", quoteSnapshotId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load booking for quote: ${error.message}`)
  return (data?.id as string | null) ?? null
}

const isAlreadyFinalized = (message: string): boolean => {
  const lower = message.toLowerCase()
  return message.includes("quote_snapshot_not_negotiable") || lower.includes("not_negotiable")
}

export const handleFinalizeBooking = async (
  supabase: SupabaseClient,
  payload: { quote_snapshot_id: string; lock_type: "full_payment" | "token_99" },
): Promise<void> => {
  const quoteSnapshotId = payload.quote_snapshot_id
  const lockType = payload.lock_type
  if (!quoteSnapshotId) throw new Error("finalize_booking requires quote_snapshot_id")
  if (lockType !== "full_payment" && lockType !== "token_99") {
    throw new Error("finalize_booking requires lock_type full_payment or token_99")
  }

  const { error } = await supabase.rpc("finalize_quote_booking", {
    p_quote_snapshot_id: quoteSnapshotId,
    p_lock_type: lockType,
  })

  if (error) {
    if (lockType === "token_99" && isAlreadyFinalized(error.message)) {
      const bookingId = await lookupBookingId(supabase, quoteSnapshotId)
      if (bookingId) await enqueueAckIfMissing(supabase, bookingId)
      return
    }
    throw new Error(`finalize_quote_booking failed: ${error.message}`)
  }

  if (lockType === "token_99") {
    const bookingId = await lookupBookingId(supabase, quoteSnapshotId)
    if (bookingId) await enqueueAckIfMissing(supabase, bookingId)
  }
}
