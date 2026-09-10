import { NextRequest } from "next/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { drainDueJobs } from "@/lib/jobs/drainDueJobs";

/**
 * Checklist 2.8: worker endpoint for delayed retries and a Hobby-safe
 * daily Vercel Cron safety net (once per day; minute/hour schedules are
 * Pro-only — https://vercel.com/docs/cron-jobs/usage-and-pricing).
 * Interactive jobs drain on demand via drainDueJobs; pg_cron invokes
 * job-queue-worker for run_after / backoff. Vercel Cron always sends GET
 * (and, with "Protect Cron Jobs" enabled, automatically adds
 * `Authorization: Bearer $CRON_SECRET`); external schedulers or manual
 * testing can use POST with the same header.
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

  try {
    return jsonOk(await drainDueJobs(supabase));
  } catch (caught) {
    return jsonError(
      502,
      caught instanceof Error ? caught.message : "Failed to drain job_queue",
    );
  }
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}
