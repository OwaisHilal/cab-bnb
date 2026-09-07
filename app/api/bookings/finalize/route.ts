import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { handleFinalizeBooking } from "@/lib/whatsapp/finalizeBooking";

const finalizeSchema = z.object({
  quote_snapshot_id: z.string().uuid(),
  lock_type: z.enum(["full_payment", "token_99"]),
});

/**
 * Plan §10 fallback route / Checklist 3.4: in-app equivalent of the
 * BOOK_FULL / BOOK_TOKEN WhatsApp buttons (Plan §7.2). Booking commit,
 * sibling quote_snapshot loss, and the trip_request/booked transition
 * all happen atomically inside `finalize_quote_booking` (migration
 * 0009), locked the same way as compute_negotiation.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonValidationError(parsed.error);
  }

  const { quote_snapshot_id, lock_type } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  try {
    await handleFinalizeBooking(supabase, { quote_snapshot_id, lock_type });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to finalize booking";
    if (message.includes("quote_snapshot_not_found")) {
      return jsonError(404, `quote_snapshot ${quote_snapshot_id} not found`);
    }
    if (message.includes("quote_snapshot_not_negotiable")) {
      return jsonError(409, "This quote is no longer available to book");
    }
    if (message.includes("tourist_not_verified")) {
      return jsonError(409, "Phone number must be OTP-verified before booking");
    }
    return jsonError(500, `Failed to finalize booking: ${message}`);
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("id, booking_ref")
    .eq("winning_quote_snapshot_id", quote_snapshot_id)
    .maybeSingle();

  if (error) {
    return jsonError(500, `Failed to load booking: ${error.message}`);
  }

  if (!data) {
    return jsonError(500, "finalize_quote_booking returned no result");
  }

  return jsonOk({
    booking_id: data.id,
    booking_ref: data.booking_ref,
  });
}
