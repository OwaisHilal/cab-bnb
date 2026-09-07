import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enqueueJob } from "../jobQueue.ts";

async function lookupBookingId(
  supabase: SupabaseClient,
  quoteSnapshotId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("winning_quote_snapshot_id", quoteSnapshotId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load booking for quote: ${error.message}`);
  return (data?.id as string | null) ?? null;
}

async function enqueueAckIfMissing(supabase: SupabaseClient, bookingId: string): Promise<void> {
  const { data: existing, error } = await supabase
    .from("job_queue")
    .select("id")
    .eq("job_type", "send_token_received_ack")
    .contains("payload", { booking_id: bookingId })
    .in("status", ["queued", "processing", "done"])
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to check token ack job: ${error.message}`);
  if (existing?.id) return;

  await enqueueJob(supabase, "send_token_received_ack", { booking_id: bookingId });
}

function isAlreadyFinalized(message: string): boolean {
  return message.includes("quote_snapshot_not_negotiable") || message.toLowerCase().includes("not_negotiable");
}

export async function handleFinalizeBooking(
  supabase: SupabaseClient,
  payload: { quote_snapshot_id: string; lock_type: "full_payment" | "token_99" },
): Promise<void> {
  const { quote_snapshot_id, lock_type } = payload;

  const { error } = await supabase.rpc("finalize_quote_booking", {
    p_quote_snapshot_id: quote_snapshot_id,
    p_lock_type: lock_type,
  });

  if (error) {
    if (lock_type === "token_99" && isAlreadyFinalized(error.message)) {
      const bookingId = await lookupBookingId(supabase, quote_snapshot_id);
      if (bookingId) await enqueueAckIfMissing(supabase, bookingId);
      return;
    }
    throw new Error(`finalize_quote_booking failed: ${error.message}`);
  }

  if (lock_type === "token_99") {
    const bookingId = await lookupBookingId(supabase, quote_snapshot_id);
    if (bookingId) await enqueueAckIfMissing(supabase, bookingId);
  }
}
