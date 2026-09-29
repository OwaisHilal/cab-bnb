import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { listTripIdsForGuestSession } from "@/lib/guest-trip/loadGuestTrip";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const cancelSchema = z.object({
  session_id: z.string().min(1),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  try {
    const tripIds = await listTripIdsForGuestSession(supabase, parsed.data.session_id);
    if (tripIds.length === 0) return jsonError(404, "No trip for this session");

    const { data: trips, error: tripError } = await supabase
      .from("trip_requests")
      .select("id, status, created_at")
      .in("id", tripIds)
      .order("created_at", { ascending: false });

    if (tripError) return jsonError(500, `Failed to fetch trip: ${tripError.message}`);

    const open = (trips ?? []).find((trip) => trip.status !== "abandoned" && trip.status !== "expired");
    const tripId = (open?.id ?? trips?.[0]?.id) as string | undefined;
    if (!tripId) return jsonError(404, "No trip for this session");

    const { error: abandonError } = await supabase.from("trip_requests").update({ status: "abandoned" }).eq("id", tripId);
    if (abandonError) return jsonError(500, `Failed to cancel trip: ${abandonError.message}`);

    const { error: bookingError } = await supabase
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("trip_request_id", tripId)
      .neq("status", "cancelled");

    if (bookingError) return jsonError(500, `Failed to cancel booking: ${bookingError.message}`);

    const { error: intentError } = await supabase
      .from("whatsapp_payment_intents")
      .update({ status: "expired" })
      .eq("trip_request_id", tripId)
      .in("status", ["pending", "sent"]);

    if (intentError) return jsonError(500, `Failed to expire payment intents: ${intentError.message}`);

    const { error: sessionError } = await supabase.from("guest_trip_sessions").delete().eq("trip_request_id", tripId);
    if (sessionError && !sessionError.message.toLowerCase().includes("does not exist") && sessionError.code !== "42P01" && sessionError.code !== "PGRST205") {
      return jsonError(500, `Failed to clear guest sessions: ${sessionError.message}`);
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to cancel trip");
  }
}
