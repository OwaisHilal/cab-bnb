import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { matchVendorRateBands } from "@/lib/matching/matchVendorRateBands";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";

const tripRequestSchema = z.object({
  session_id: z.string().min(1),
  pickup_location: z.string().optional(),
  drop_location: z.string().optional(),
  trip_start_date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "trip_start_date must be a valid date",
  }),
  trip_days: z.number().int().min(1).max(30),
  pax_count: z.number().int().min(1).max(20),
  requested_vehicle_type_id: z.number().int().positive(),
});

/**
 * Checklist 2.1: create trip_request, run matching + recommendation, create
 * quote_snapshots, return a summary. No WhatsApp send here (Plan §5 — that
 * only happens after OTP verify, via job_queue).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = tripRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonValidationError(parsed.error);
  }

  const {
    session_id,
    pickup_location,
    drop_location,
    trip_start_date,
    trip_days,
    pax_count,
    requested_vehicle_type_id,
  } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data: tripRequest, error: insertError } = await supabase
    .from("trip_requests")
    .insert({
      session_id,
      pickup_location: pickup_location ?? null,
      drop_location: drop_location ?? null,
      trip_start_date,
      trip_days,
      pax_count,
      requested_vehicle_type_id,
      status: "matching",
    })
    .select("id")
    .single();

  if (insertError || !tripRequest) {
    return jsonError(500, `Failed to create trip request: ${insertError?.message ?? "unknown error"}`);
  }

  const tripRequestId = tripRequest.id as string;

  let matchResult;
  try {
    matchResult = await matchVendorRateBands(supabase, {
      paxCount: pax_count,
      tripDays: trip_days,
      tripStartDate: trip_start_date,
      requestedVehicleTypeId: requested_vehicle_type_id,
    });
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Matching failed");
  }

  const { matchedBands, recommendation } = matchResult;

  if (matchedBands.length > 0) {
    // Plan invariant: the opening price shown per vendor is always max_quote,
    // never min_quote. min_quote_floor is persisted for later negotiation
    // rounds only — never returned to the client (see GET [id]/route.ts).
    const lowestQuote = Math.min(...matchedBands.map((band) => band.maxQuote));

    const quoteSnapshotRows = matchedBands.map((band) => ({
      trip_request_id: tripRequestId,
      vendor_id: band.vendorId,
      vendor_rate_band_id: band.vendorRateBandId,
      vehicle_type_id: band.vehicleTypeId,
      initial_quote: band.maxQuote,
      min_quote_floor: band.minQuote,
      current_quote: band.maxQuote,
      is_best_price: band.maxQuote === lowestQuote,
      status: "pending_send",
    }));

    const { error: quoteInsertError } = await supabase
      .from("quote_snapshots")
      .insert(quoteSnapshotRows);

    if (quoteInsertError) {
      return jsonError(500, `Failed to create quote snapshots: ${quoteInsertError.message}`);
    }
  }

  const { error: updateError } = await supabase
    .from("trip_requests")
    .update({
      status: "quotes_ready",
      recommended_vehicle_type_id: recommendation?.recommendedVehicleTypeId ?? null,
      recommendation_reason: recommendation?.reason ?? null,
    })
    .eq("id", tripRequestId);

  if (updateError) {
    return jsonError(500, `Failed to update trip request: ${updateError.message}`);
  }

  return jsonOk({
    trip_request_id: tripRequestId,
    matched_vendor_count: matchedBands.length,
    recommendation: recommendation
      ? {
          recommended_vehicle_type_id: recommendation.recommendedVehicleTypeId,
          reason: recommendation.reason,
        }
      : null,
  });
}
