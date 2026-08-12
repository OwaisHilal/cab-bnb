import { NextRequest } from "next/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/api/errors";

/**
 * Checklist 3.9: worker endpoint invoked on a schedule by a cron scheduler,
 * secured via CRON_SECRET (same pattern as app/api/cron/dispatch-jobs/
 * route.ts). Invokes the `expire-stale-quotes` Edge Function, which expires
 * `quote_snapshots` with no response after `QUOTE_EXPIRY_HOURS` — this does
 * not go through `job_queue`.
 */
async function handleDispatch(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return jsonError(500, "Missing CRON_SECRET. Copy .env.example to .env.local and fill it in.");
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return jsonError(401, "Unauthorized");
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data, error } = await supabase.functions.invoke("expire-stale-quotes");

  if (error) {
    return jsonError(502, `expire-stale-quotes invocation failed: ${error.message}`);
  }

  return jsonOk(data ?? { expiredSnapshots: 0, expiredTripRequests: 0 });
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}
