import { NextRequest } from "next/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/api/errors";

interface QuoteSnapshotRow {
  id: string;
  current_quote: number;
  is_best_price: boolean;
  status: string;
  vendors: { business_name: string } | { business_name: string }[] | null;
  vehicle_types: { label: string } | { label: string }[] | null;
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Checklist 2.2: poll trip_request + quote_snapshots (fallback if not using
 * Supabase Realtime).
 *
 * Security (Plan §11): only customer-safe columns are selected below. Never
 * select/return `min_quote_floor` or any `vendor_rate_bands` negotiation
 * columns (`negotiation_step_min/max`, `max_negotiation_rounds`) to the
 * client — all negotiation math stays server-side.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/trip-requests/[id]">) {
  const { id } = await ctx.params;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data: tripRequest, error: tripRequestError } = await supabase
    .from("trip_requests")
    .select("id, status, recommended_vehicle_type_id, recommendation_reason")
    .eq("id", id)
    .maybeSingle();

  if (tripRequestError) {
    return jsonError(500, `Failed to fetch trip request: ${tripRequestError.message}`);
  }
  if (!tripRequest) {
    return jsonError(404, `trip_request ${id} not found`);
  }

  const { data: quotes, error: quotesError } = await supabase
    .from("quote_snapshots")
    .select("id, current_quote, is_best_price, status, vendors(business_name), vehicle_types(label)")
    .eq("trip_request_id", id)
    .order("current_quote", { ascending: true });

  if (quotesError) {
    return jsonError(500, `Failed to fetch quote snapshots: ${quotesError.message}`);
  }

  const safeQuotes = ((quotes ?? []) as unknown as QuoteSnapshotRow[]).map((quote) => ({
    id: quote.id,
    vendor_name: firstOrSelf(quote.vendors)?.business_name ?? "Vendor",
    vehicle_type_label: firstOrSelf(quote.vehicle_types)?.label ?? "Vehicle",
    current_quote: quote.current_quote,
    is_best_price: quote.is_best_price,
    status: quote.status,
  }));

  return jsonOk({
    trip_request_id: tripRequest.id,
    status: tripRequest.status,
    recommendation: tripRequest.recommended_vehicle_type_id
      ? {
          recommended_vehicle_type_id: tripRequest.recommended_vehicle_type_id,
          reason: tripRequest.recommendation_reason,
        }
      : null,
    matched_vendor_count: safeQuotes.length,
    quotes: safeQuotes,
  });
}
