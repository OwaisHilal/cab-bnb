import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Checklist 3.4: async counterpart of app/api/bookings/finalize/route.ts,
 * triggered when the customer taps BOOK_FULL/BOOK_TOKEN over WhatsApp
 * (webhook -> job_queue, see lib/whatsapp/webhook/enqueueWebhookAction.ts)
 * rather than the in-app fallback route (Plan §10).
 *
 * Delegates to the existing `finalize_quote_booking` Postgres function
 * (migration 0009, unchanged) — same row lock, same sibling-snapshot-loss
 * and notify_vendor_booking enqueue behavior either path takes.
 *
 * No customer-facing message here: per Plan §6.4 the confirmation card is
 * only sent once the vendor's driver details are parsed (Phase 2d/2e,
 * out of scope for this increment).
 */
export async function handleFinalizeBooking(
  supabase: SupabaseClient,
  payload: { quote_snapshot_id: string; lock_type: "full_payment" | "token_99" },
): Promise<void> {
  const { quote_snapshot_id, lock_type } = payload;

  const { error } = await supabase.rpc("finalize_quote_booking", {
    p_quote_snapshot_id: quote_snapshot_id,
    p_lock_type: lock_type,
  });

  if (error) throw new Error(`finalize_quote_booking failed: ${error.message}`);
}
