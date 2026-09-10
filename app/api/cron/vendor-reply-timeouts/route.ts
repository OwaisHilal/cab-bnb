import { NextRequest } from "next/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/api/errors";

/**
 * Plan §9 / Phase 3 final pass: worker endpoint invoked every 10 minutes
 * by pg_cron, with a Hobby-safe daily Vercel Cron safety net. Secured via
 * CRON_SECRET. Invokes `vendor-reply-timeouts`, which escalates bookings
 * still waiting on a vendor's `DRIVER:` reply past SLA — this does not go
 * through `job_queue`.
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

  const { data, error } = await supabase.functions.invoke("vendor-reply-timeouts");

  if (error) {
    return jsonError(502, `vendor-reply-timeouts invocation failed: ${error.message}`);
  }

  return jsonOk(data ?? { escalated: 0 });
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}
