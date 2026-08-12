import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const SEDAN_SEAT_CAPACITY = 4;
const SEDAN_VEHICLE_CODE = "sedan";
const SUV_VEHICLE_CODE = "suv";

export type SeasonQuarter = "Q1" | "Q2" | "Q3" | "Q4" | "PEAK" | "OFF_PEAK" | "ALL_YEAR";

export interface MatchedVendorBand {
  vendorRateBandId: string;
  vendorId: string;
  vendorName: string;
  vehicleTypeId: number;
  maxQuote: number;
  minQuote: number;
}

export interface VehicleRecommendation {
  recommendedVehicleTypeId: number;
  reason: string;
}

export interface MatchTripRequestInput {
  paxCount: number;
  tripDays: number;
  tripStartDate: string;
  requestedVehicleTypeId: number;
}

export interface MatchTripRequestResult {
  matchedBands: MatchedVendorBand[];
  recommendation: VehicleRecommendation | null;
}

interface RawVendorEmbed {
  business_name: string;
  status: string;
}

interface RawRateBandRow {
  id: string;
  vendor_id: string;
  vehicle_type_id: number;
  max_quote: number;
  min_quote: number;
  vendors: RawVendorEmbed | RawVendorEmbed[] | null;
}

/**
 * Deno-side port of lib/matching/resolveSeasonQuarter.ts. Edge Functions
 * cannot import Next.js app code (server-only + bundling constraints), so
 * this mirrors the same plain-calendar-quarter semantics — keep both in
 * sync if the resolution rule ever changes.
 */
function resolveSeasonQuarter(tripStartDate: string): SeasonQuarter {
  const month = new Date(tripStartDate).getUTCMonth();

  if (month <= 2) return "Q1";
  if (month <= 5) return "Q2";
  if (month <= 8) return "Q3";
  return "Q4";
}

function getVendorName(vendors: RawRateBandRow["vendors"]): string {
  if (!vendors) return "Vendor";
  if (Array.isArray(vendors)) return vendors[0]?.business_name ?? "Vendor";
  return vendors.business_name ?? "Vendor";
}

async function queryBandsForVehicleType(
  supabase: SupabaseClient,
  vehicleTypeId: number,
  paxCount: number,
  tripDays: number,
  seasonQuarter: SeasonQuarter,
): Promise<RawRateBandRow[]> {
  const { data, error } = await supabase
    .from("vendor_rate_bands")
    .select("id, vendor_id, vehicle_type_id, max_quote, min_quote, vendors!inner(business_name, status)")
    .eq("vehicle_type_id", vehicleTypeId)
    .eq("is_active", true)
    .eq("vendors.status", "active")
    .lte("pax_min", paxCount)
    .gte("pax_max", paxCount)
    .lte("trip_days_min", tripDays)
    .gte("trip_days_max", tripDays)
    .or(`season_quarter.eq.${seasonQuarter},season_quarter.eq.ALL_YEAR`)
    .order("max_quote", { ascending: true });

  if (error) {
    throw new Error(`Failed to query vendor_rate_bands: ${error.message}`);
  }

  return (data ?? []) as unknown as RawRateBandRow[];
}

function toMatchedVendorBand(row: RawRateBandRow): MatchedVendorBand {
  return {
    vendorRateBandId: row.id,
    vendorId: row.vendor_id,
    vendorName: getVendorName(row.vendors),
    vehicleTypeId: row.vehicle_type_id,
    maxQuote: row.max_quote,
    minQuote: row.min_quote,
  };
}

interface RecommendationContext {
  paxCount: number;
  tripDays: number;
  requestedVehicleTypeCode: string;
  seasonQuarter: SeasonQuarter;
  sedanMatchedBands: MatchedVendorBand[];
}

/**
 * Plan §3.3: only triggers when the requested type is sedan and the party
 * exceeds sedan capacity. Kept in sync with
 * lib/matching/matchVendorRateBands.ts:computeVehicleRecommendation.
 */
async function computeVehicleRecommendation(
  supabase: SupabaseClient,
  context: RecommendationContext,
): Promise<VehicleRecommendation | null> {
  if (
    context.requestedVehicleTypeCode !== SEDAN_VEHICLE_CODE ||
    context.paxCount <= SEDAN_SEAT_CAPACITY ||
    context.sedanMatchedBands.length === 0
  ) {
    return null;
  }

  const { data: suvType, error: suvTypeError } = await supabase
    .from("vehicle_types")
    .select("id")
    .eq("code", SUV_VEHICLE_CODE)
    .single();

  if (suvTypeError || !suvType) return null;

  const suvBands = await queryBandsForVehicleType(
    supabase,
    suvType.id,
    context.paxCount,
    context.tripDays,
    context.seasonQuarter,
  );

  if (suvBands.length === 0) return null;

  const nSedans = Math.ceil(context.paxCount / SEDAN_SEAT_CAPACITY);
  const cheapestSedanMaxQuote = Math.min(...context.sedanMatchedBands.map((band) => band.maxQuote));
  const sedanTotalCost = nSedans * cheapestSedanMaxQuote;
  const cheapestSuvMaxQuote = Math.min(...suvBands.map((row) => row.max_quote));

  if (cheapestSuvMaxQuote >= sedanTotalCost) return null;

  return {
    recommendedVehicleTypeId: suvType.id,
    reason: `${nSedans} sedans won't seat ${context.paxCount} pax as comfortably for ${context.tripDays} day(s) — 1 SUV at ₹${cheapestSuvMaxQuote} beats ₹${sedanTotalCost} for ${nSedans} sedans.`,
  };
}

/**
 * Checklist 3.1: standalone-callable Deno port of
 * lib/matching/matchVendorRateBands.ts — same pure matching query against
 * `vendor_rate_bands`, no hardcoded vendor pricing logic. Read-only: does
 * not create trip_requests or quote_snapshots.
 */
export async function handleMatchVendorRateBands(
  supabase: SupabaseClient,
  input: MatchTripRequestInput,
): Promise<MatchTripRequestResult> {
  const seasonQuarter = resolveSeasonQuarter(input.tripStartDate);

  const { data: vehicleType, error: vehicleTypeError } = await supabase
    .from("vehicle_types")
    .select("id, code")
    .eq("id", input.requestedVehicleTypeId)
    .single();

  if (vehicleTypeError || !vehicleType) {
    throw new Error(`Unknown requested_vehicle_type_id: ${input.requestedVehicleTypeId}`);
  }

  const rawBands = await queryBandsForVehicleType(
    supabase,
    input.requestedVehicleTypeId,
    input.paxCount,
    input.tripDays,
    seasonQuarter,
  );

  const matchedBands = rawBands.map(toMatchedVendorBand);

  const recommendation = await computeVehicleRecommendation(supabase, {
    paxCount: input.paxCount,
    tripDays: input.tripDays,
    requestedVehicleTypeCode: vehicleType.code as string,
    seasonQuarter,
    sedanMatchedBands: matchedBands,
  });

  return { matchedBands, recommendation };
}
