import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleMatchVendorRateBands } from "../_shared/handlers/matchVendorRateBands.ts";

interface MatchRequestBody {
  pax_count?: unknown;
  trip_days?: unknown;
  trip_start_date?: unknown;
  requested_vehicle_type_id?: unknown;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/**
 * Checklist 3.1 — standalone-callable, read-only Edge Function wrapper
 * around handleMatchVendorRateBands. Returns matched vendor rate bands and
 * an optional sedan-to-SUV recommendation; never creates trip_requests or
 * quote_snapshots.
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  let body: MatchRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), { status: 400 });
  }

  if (!isPositiveInteger(body.pax_count)) {
    return new Response(JSON.stringify({ error: "pax_count must be a positive integer" }), { status: 400 });
  }

  if (!isPositiveInteger(body.trip_days)) {
    return new Response(JSON.stringify({ error: "trip_days must be a positive integer" }), { status: 400 });
  }

  if (!isValidDateString(body.trip_start_date)) {
    return new Response(JSON.stringify({ error: "trip_start_date must be a valid date string" }), {
      status: 400,
    });
  }

  if (!isPositiveInteger(body.requested_vehicle_type_id)) {
    return new Response(
      JSON.stringify({ error: "requested_vehicle_type_id must be a positive integer" }),
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabaseServiceRoleClient();
    const result = await handleMatchVendorRateBands(supabase, {
      paxCount: body.pax_count,
      tripDays: body.trip_days,
      tripStartDate: body.trip_start_date,
      requestedVehicleTypeId: body.requested_vehicle_type_id,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "match-vendor-rate-bands failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
