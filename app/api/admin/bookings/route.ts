import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { checkAdminAuth } from "@/lib/api/adminAuth";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";

const BOOKING_STATUSES = [
  "draft",
  "payment_pending",
  "token_locked",
  "fully_paid",
  "vendor_confirming",
  "vendor_confirmed",
  "driver_attach_pending",
  "driver_attached",
  "ready_for_pickup",
  "in_trip",
  "completed",
  "cancelled",
  "refund_pending",
  "refunded",
  "quote_negotiating",
  "no_response_exception",
] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const querySchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  vendor_id: z.string().uuid().optional(),
  tourist_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

interface TouristRow {
  phone_e164: string;
  full_name: string | null;
}

interface VendorRow {
  business_name: string;
  whatsapp_number: string;
}

interface VehicleTypeRow {
  label: string;
}

interface TripRequestRow {
  pickup_location: string | null;
  drop_location: string | null;
  trip_start_date: string;
}

interface BookingAdminRow {
  id: string;
  booking_ref: string;
  status: string;
  payment_status: string;
  lock_type: string | null;
  final_quote: number | null;
  pickup_at: string;
  trip_days: number;
  pax_count: number;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
  tourist: TouristRow | TouristRow[] | null;
  vendor: VendorRow | VendorRow[] | null;
  vehicle_type: VehicleTypeRow | VehicleTypeRow[] | null;
  trip_request: TripRequestRow | TripRequestRow[] | null;
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Plan §10 / Checklist audit gap G1: read-only ops dashboard feed for
 * bookings. Bearer-gated the same way as
 * app/api/admin/rate-bands/route.ts (Checklist 2.6) — no admin
 * login/session system exists yet, so this reuses the ADMIN_API_SECRET
 * pattern rather than inventing a second scheme.
 *
 * Unlike trip_requests, bookings has exactly one foreign key into each of
 * tourists/vendors/vehicle_types/trip_requests, so plain embeds are
 * unambiguous — no FK hint syntax needed here.
 */
export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  const parsed = querySchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    vendor_id: request.nextUrl.searchParams.get("vendor_id") ?? undefined,
    tourist_id: request.nextUrl.searchParams.get("tourist_id") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) return jsonValidationError(parsed.error);

  const { status, vendor_id, tourist_id, limit } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  let query = supabase
    .from("bookings")
    .select(
      "id, booking_ref, status, payment_status, lock_type, final_quote, pickup_at, trip_days, pax_count, created_at, updated_at, cancelled_at, completed_at, " +
        "tourist:tourists(phone_e164, full_name), " +
        "vendor:vendors(business_name, whatsapp_number), " +
        "vehicle_type:vehicle_types(label), " +
        "trip_request:trip_requests(pickup_location, drop_location, trip_start_date)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (vendor_id) query = query.eq("vendor_id", vendor_id);
  if (tourist_id) query = query.eq("tourist_id", tourist_id);

  const { data, error } = await query;
  if (error) return jsonError(500, `Failed to fetch bookings: ${error.message}`);

  const rows = (data ?? []) as unknown as BookingAdminRow[];

  const bookings = rows.map((row) => {
    const tourist = firstOrSelf(row.tourist);
    const vendor = firstOrSelf(row.vendor);
    const vehicleType = firstOrSelf(row.vehicle_type);
    const tripRequest = firstOrSelf(row.trip_request);

    return {
      id: row.id,
      booking_ref: row.booking_ref,
      status: row.status,
      payment_status: row.payment_status,
      lock_type: row.lock_type,
      final_quote: row.final_quote,
      pickup_at: row.pickup_at,
      trip_days: row.trip_days,
      pax_count: row.pax_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
      cancelled_at: row.cancelled_at,
      completed_at: row.completed_at,
      tourist_phone: tourist?.phone_e164 ?? null,
      tourist_name: tourist?.full_name ?? null,
      vendor_name: vendor?.business_name ?? null,
      vendor_whatsapp_number: vendor?.whatsapp_number ?? null,
      vehicle_type_label: vehicleType?.label ?? null,
      pickup_location: tripRequest?.pickup_location ?? null,
      drop_location: tripRequest?.drop_location ?? null,
      trip_start_date: tripRequest?.trip_start_date ?? null,
    };
  });

  return jsonOk({ bookings });
}
