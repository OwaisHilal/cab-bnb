import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { checkAdminAuth } from "@/lib/api/adminAuth";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";

const TRIP_REQUEST_STATUSES = [
  "matching",
  "quotes_ready",
  "otp_pending",
  "quotes_sent",
  "negotiating",
  "booked",
  "expired",
  "abandoned",
] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const querySchema = z.object({
  status: z.enum(TRIP_REQUEST_STATUSES).optional(),
  tourist_id: z.string().uuid().optional(),
  session_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

interface TouristRow {
  phone_e164: string;
  full_name: string | null;
}

interface VehicleTypeRow {
  label: string;
}

interface VendorRow {
  business_name: string;
}

interface QuoteSnapshotRow {
  id: string;
  vendor_id: string;
  current_quote: number;
  initial_quote: number;
  is_best_price: boolean;
  status: string;
  vendors: VendorRow | VendorRow[] | null;
}

interface TripRequestAdminRow {
  id: string;
  session_id: string;
  status: string;
  pickup_location: string | null;
  drop_location: string | null;
  trip_start_date: string;
  trip_days: number;
  pax_count: number;
  recommendation_reason: string | null;
  created_at: string;
  updated_at: string;
  tourist: TouristRow | TouristRow[] | null;
  requested_vehicle_type: VehicleTypeRow | VehicleTypeRow[] | null;
  recommended_vehicle_type: VehicleTypeRow | VehicleTypeRow[] | null;
  quote_snapshots: QuoteSnapshotRow[] | null;
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Plan §10 / Checklist audit gap G1: read-only ops dashboard feed for
 * trip_requests. Bearer-gated the same way as
 * app/api/admin/rate-bands/route.ts (Checklist 2.6) — there is no admin
 * login/session system yet, so this reuses the ADMIN_API_SECRET pattern
 * rather than inventing a second scheme.
 *
 * `requested_vehicle_type`/`recommended_vehicle_type` both embed
 * vehicle_types via explicit FK hints because trip_requests has two
 * separate foreign keys into that table — PostgREST can't disambiguate
 * a plain `vehicle_types(label)` embed otherwise. The constraint names
 * below are Postgres's default `<table>_<column>_fkey` naming, since
 * migration 0003 declares both columns with inline `references` and no
 * explicit constraint name.
 */
export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  const parsed = querySchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    tourist_id: request.nextUrl.searchParams.get("tourist_id") ?? undefined,
    session_id: request.nextUrl.searchParams.get("session_id") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) return jsonValidationError(parsed.error);

  const { status, tourist_id, session_id, limit } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  let query = supabase
    .from("trip_requests")
    .select(
      "id, session_id, status, pickup_location, drop_location, trip_start_date, trip_days, pax_count, recommendation_reason, created_at, updated_at, " +
        "tourist:tourists(phone_e164, full_name), " +
        "requested_vehicle_type:vehicle_types!trip_requests_requested_vehicle_type_id_fkey(label), " +
        "recommended_vehicle_type:vehicle_types!trip_requests_recommended_vehicle_type_id_fkey(label), " +
        "quote_snapshots(id, vendor_id, current_quote, initial_quote, is_best_price, status, vendors(business_name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (tourist_id) query = query.eq("tourist_id", tourist_id);
  if (session_id) query = query.eq("session_id", session_id);

  const { data, error } = await query;
  if (error) return jsonError(500, `Failed to fetch trip requests: ${error.message}`);

  const rows = (data ?? []) as unknown as TripRequestAdminRow[];

  const tripRequests = rows.map((row) => {
    const tourist = firstOrSelf(row.tourist);
    const requestedVehicleType = firstOrSelf(row.requested_vehicle_type);
    const recommendedVehicleType = firstOrSelf(row.recommended_vehicle_type);

    return {
      id: row.id,
      session_id: row.session_id,
      status: row.status,
      pickup_location: row.pickup_location,
      drop_location: row.drop_location,
      trip_start_date: row.trip_start_date,
      trip_days: row.trip_days,
      pax_count: row.pax_count,
      recommendation_reason: row.recommendation_reason,
      created_at: row.created_at,
      updated_at: row.updated_at,
      tourist_phone: tourist?.phone_e164 ?? null,
      tourist_name: tourist?.full_name ?? null,
      requested_vehicle_type_label: requestedVehicleType?.label ?? null,
      recommended_vehicle_type_label: recommendedVehicleType?.label ?? null,
      quotes: (row.quote_snapshots ?? []).map((quote) => ({
        id: quote.id,
        vendor_id: quote.vendor_id,
        vendor_name: firstOrSelf(quote.vendors)?.business_name ?? "Vendor",
        current_quote: quote.current_quote,
        initial_quote: quote.initial_quote,
        is_best_price: quote.is_best_price,
        status: quote.status,
      })),
    };
  });

  return jsonOk({ trip_requests: tripRequests });
}
