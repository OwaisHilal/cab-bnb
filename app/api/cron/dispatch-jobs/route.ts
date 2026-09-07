import { NextRequest } from "next/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { processDueJobs } from "@/lib/jobs/processDueJobs";

/**
 * Checklist 2.8: worker endpoint invoked every 1 min by a scheduler,
 * secured via CRON_SECRET. Vercel Cron always sends GET (and, with
 * "Protect Cron Jobs" enabled, automatically adds
 * `Authorization: Bearer $CRON_SECRET`); external schedulers or manual
 * testing can use POST with the same header — both are handled identically
 * below and just invoke the job-queue-worker Edge Function (Checklist 3.10),
 * which does the actual claiming/dispatch/retry logic.
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

  const { data, error } = await supabase.functions.invoke("job-queue-worker");

  let local: { claimed: number; succeeded: number; failed: number } | null = null;
  let localError: string | undefined;
  try {
    local = await processDueJobs(supabase);
  } catch (caught) {
    localError = caught instanceof Error ? caught.message : "unknown";
  }

  if (!error && !localError) {
    return jsonOk({ worker: data ?? { claimed: 0, succeeded: 0, failed: 0 }, local });
  }

  if (error && localError) {
    return jsonError(
      502,
      `job-queue-worker invocation failed: ${error.message}; local fallback failed: ${localError}`,
    );
  }

  return jsonOk({
    worker: error ? null : (data ?? { claimed: 0, succeeded: 0, failed: 0 }),
    workerError: error?.message,
    local,
    localError,
  });
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}
