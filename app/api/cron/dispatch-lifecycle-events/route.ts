import { NextRequest } from "next/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/api/errors";

/**
 * Checklist 3.8: worker endpoint invoked on a schedule by pg_cron (every
 * 15 min) with a Hobby-safe daily Vercel Cron safety net. Secured via
 * CRON_SECRET. Invokes `dispatch-lifecycle-events`, which sends any due
 * `booking_lifecycle_events` row directly — this does not go through
 * `job_queue`.
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

  const { data, error } = await supabase.functions.invoke("dispatch-lifecycle-events");

  if (error) {
    return jsonError(502, `dispatch-lifecycle-events invocation failed: ${error.message}`);
  }

  return jsonOk(data ?? { sent: 0, failed: 0 });
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}
