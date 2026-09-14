import { NextRequest } from "next/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { reconcilePendingCashfreePaymentLinks } from "@/lib/cashfree/reconcile";
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

  let jobs;
  try {
    jobs = await drainDueJobs(supabase);
  } catch (caught) {
    return jsonError(
      502,
      caught instanceof Error ? caught.message : "Failed to drain job_queue",
    );
  }

  // Best-effort missed-webhook catch-up for Cashfree Payment Links — see
  // docs/cashfree-payment-links-workaround.md "Missed-webhook safety net".
  // Never let a reconciliation failure fail the whole daily cron.
  let cashfreeReconcile;
  try {
    cashfreeReconcile = await reconcilePendingCashfreePaymentLinks(supabase);
  } catch (caught) {
    console.error("[dispatch-jobs] cashfree reconcile failed", caught);
    cashfreeReconcile = { checked: 0, confirmed: 0, errors: 1 };
  }

  return jsonOk({ ...jobs, cashfreeReconcile });
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}
