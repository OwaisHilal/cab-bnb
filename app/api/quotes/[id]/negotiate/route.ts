import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";

const paramsSchema = z.object({ id: z.string().uuid() });

interface ComputeNegotiationRow {
  next_quote: number;
  is_final: boolean;
  negotiation_round: number;
}

/**
 * Plan §10 fallback route / Checklist 3.3: in-app equivalent of the
 * NEGOTIATE WhatsApp button (Plan §7.2). All negotiation math and the
 * `select ... for update` row lock live in the `compute_negotiation`
 * Postgres function (migration 0009) — this route never computes or
 * exposes min_quote_floor / negotiation_step_* to the client.
 */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/quotes/[id]/negotiate">) {
  const { id } = await ctx.params;

  const parsedParams = paramsSchema.safeParse({ id });
  if (!parsedParams.success) {
    return jsonValidationError(parsedParams.error);
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data, error } = await supabase
    .rpc("compute_negotiation", { p_quote_snapshot_id: id })
    .single<ComputeNegotiationRow>();

  if (error) {
    if (error.message.includes("quote_snapshot_not_found")) {
      return jsonError(404, `quote_snapshot ${id} not found`);
    }
    if (error.message.includes("quote_snapshot_not_negotiable")) {
      return jsonError(409, "This quote is no longer open for negotiation");
    }
    return jsonError(500, `Failed to compute negotiation: ${error.message}`);
  }

  if (!data) {
    return jsonError(500, "compute_negotiation returned no result");
  }

  return jsonOk({
    quote_snapshot_id: id,
    next_quote: data.next_quote,
    is_final: data.is_final,
    negotiation_round: data.negotiation_round,
  });
}
