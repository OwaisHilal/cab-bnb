import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSeasonQuarter } from "./resolveSeasonQuarter";
import type {
  MatchedVendorBand,
  MatchTripRequestInput,
  MatchTripRequestResult,
  SeasonQuarter,
  VehicleRecommendation,
} from "./types";

const SEDAN_SEAT_CAPACITY = 4;
const SEDAN_VEHICLE_CODE = "sedan";
const SUV_VEHICLE_CODE = "suv";

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

/**
 * Plan §3.2 / Checklist 3.1: pure matching query against `vendor_rate_bands`,
 * implemented as a plain server function for this increment (Edge Function
 * extraction is a Phase 3 task). No hardcoded vendor pricing logic — every
 * result comes straight from the configurable rate-band table.
 */
export async function matchVendorRateBands(
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

interface RecommendationContext {
  paxCount: number;
  tripDays: number;
  requestedVehicleTypeCode: string;
  seasonQuarter: SeasonQuarter;
  sedanMatchedBands: MatchedVendorBand[];
}

/**
 * Plan §3.3: only triggers when the requested type is sedan and the party
 * exceeds sedan capacity. Computed server-side and returned as part of the
 * trip-request response payload — the frontend only renders it.
 */
export async function computeVehicleRecommendation(
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
