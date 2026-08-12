import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { checkAdminAuth } from "@/lib/api/adminAuth";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";

const SEASON_QUARTERS = ["Q1", "Q2", "Q3", "Q4", "PEAK", "OFF_PEAK", "ALL_YEAR"] as const;

/**
 * Checklist 2.6: internal CRUD for vendor_rate_bands — the pricing
 * configuration engine matchVendorRateBands.ts reads from (migration
 * 0002). Mirrors that migration's own constraints in the zod schemas
 * (valid_range, valid_pax, valid_days, valid_negotiation_step) so invalid
 * bands are rejected here with a clear message instead of a raw
 * Postgres constraint-violation error.
 */
const rateBandCreateSchema = z
  .object({
    vendor_id: z.string().uuid(),
    vehicle_type_id: z.number().int().positive(),
    vehicle_model: z.string().optional(),
    pax_min: z.number().int().min(1),
    pax_max: z.number().int().min(1),
    trip_days_min: z.number().int().min(1).default(1),
    trip_days_max: z.number().int().min(1).default(1),
    season_quarter: z.enum(SEASON_QUARTERS).default("ALL_YEAR"),
    min_quote: z.number().positive(),
    max_quote: z.number().positive(),
    negotiation_step_min: z.number().nonnegative().default(50),
    negotiation_step_max: z.number().nonnegative().default(150),
    max_negotiation_rounds: z.number().int().positive().default(3),
    is_active: z.boolean().default(true),
    priority: z.number().int().default(100),
  })
  .refine((band) => band.min_quote <= band.max_quote, {
    message: "min_quote must be <= max_quote",
    path: ["min_quote"],
  })
  .refine((band) => band.pax_min <= band.pax_max, { message: "pax_min must be <= pax_max", path: ["pax_min"] })
  .refine((band) => band.trip_days_min <= band.trip_days_max, {
    message: "trip_days_min must be <= trip_days_max",
    path: ["trip_days_min"],
  })
  .refine((band) => band.negotiation_step_min <= band.negotiation_step_max, {
    message: "negotiation_step_min must be <= negotiation_step_max",
    path: ["negotiation_step_min"],
  });

const rateBandPatchSchema = z.object({
  id: z.string().uuid(),
  vehicle_model: z.string().optional(),
  pax_min: z.number().int().min(1).optional(),
  pax_max: z.number().int().min(1).optional(),
  trip_days_min: z.number().int().min(1).optional(),
  trip_days_max: z.number().int().min(1).optional(),
  season_quarter: z.enum(SEASON_QUARTERS).optional(),
  min_quote: z.number().positive().optional(),
  max_quote: z.number().positive().optional(),
  negotiation_step_min: z.number().nonnegative().optional(),
  negotiation_step_max: z.number().nonnegative().optional(),
  max_negotiation_rounds: z.number().int().positive().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().optional(),
});

export async function GET(request: NextRequest) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const vendorId = request.nextUrl.searchParams.get("vendor_id");
  const vehicleTypeId = request.nextUrl.searchParams.get("vehicle_type_id");

  let query = supabase.from("vendor_rate_bands").select("*").order("created_at", { ascending: false });
  if (vendorId) query = query.eq("vendor_id", vendorId);
  if (vehicleTypeId) query = query.eq("vehicle_type_id", Number(vehicleTypeId));

  const { data, error } = await query;
  if (error) return jsonError(500, `Failed to fetch rate bands: ${error.message}`);

  return jsonOk({ rate_bands: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = rateBandCreateSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data, error } = await supabase.from("vendor_rate_bands").insert(parsed.data).select("*").single();
  if (error) return jsonError(500, `Failed to create rate band: ${error.message}`);

  return jsonOk({ rate_band: data }, 201);
}

export async function PATCH(request: NextRequest) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = rateBandPatchSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { id, ...updates } = parsed.data;
  if (Object.keys(updates).length === 0) {
    return jsonError(400, "No fields to update");
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data: existing, error: fetchError } = await supabase
    .from("vendor_rate_bands")
    .select("min_quote, max_quote, pax_min, pax_max, trip_days_min, trip_days_max, negotiation_step_min, negotiation_step_max")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return jsonError(500, `Failed to fetch rate band: ${fetchError.message}`);
  if (!existing) return jsonError(404, `vendor_rate_band ${id} not found`);

  const merged = { ...existing, ...updates };
  if (merged.min_quote > merged.max_quote) return jsonError(400, "min_quote must be <= max_quote");
  if (merged.pax_min > merged.pax_max) return jsonError(400, "pax_min must be <= pax_max");
  if (merged.trip_days_min > merged.trip_days_max) return jsonError(400, "trip_days_min must be <= trip_days_max");
  if (merged.negotiation_step_min > merged.negotiation_step_max) {
    return jsonError(400, "negotiation_step_min must be <= negotiation_step_max");
  }

  const { data, error } = await supabase
    .from("vendor_rate_bands")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return jsonError(500, `Failed to update rate band: ${error.message}`);

  return jsonOk({ rate_band: data });
}
