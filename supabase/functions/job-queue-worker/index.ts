import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleSendQuotes } from "../_shared/handlers/sendQuotes.ts";
import { handleComputeNegotiation } from "../_shared/handlers/computeNegotiation.ts";
import { handleFinalizeBooking } from "../_shared/handlers/finalizeBooking.ts";

const BATCH_SIZE = 20;
const MAX_BACKOFF_MINUTES = 60;

interface JobQueueRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/**
 * Checklist 3.10: central job_queue dispatcher, invoked every 1 min by
 * app/api/cron/dispatch-jobs/route.ts (Checklist 2.8). Only claims
 * job_types with a registered handler below — anything else (e.g.
 * notify_vendor_booking, parse_driver_details — Phase 2d/2e) is left
 * `queued` untouched rather than mis-marked as failed.
 */
const HANDLERS: Record<string, (supabase: SupabaseClient, payload: Record<string, unknown>) => Promise<void>> = {
  // deno-lint-ignore no-explicit-any
  send_quotes: (supabase, payload) => handleSendQuotes(supabase, payload as any),
  // deno-lint-ignore no-explicit-any
  compute_negotiation: (supabase, payload) => handleComputeNegotiation(supabase, payload as any),
  // deno-lint-ignore no-explicit-any
  finalize_booking: (supabase, payload) => handleFinalizeBooking(supabase, payload as any),
};

function backoffRunAfter(attempts: number): string {
  const minutes = Math.min(2 ** attempts, MAX_BACKOFF_MINUTES);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function processJob(supabase: SupabaseClient, job: JobQueueRow): Promise<boolean> {
  const handler = HANDLERS[job.job_type];

  try {
    if (!handler) throw new Error(`No handler registered for job_type "${job.job_type}"`);
    await handler(supabase, job.payload);
    await supabase.from("job_queue").update({ status: "done" }).eq("id", job.id);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job error";
    const isFinalAttempt = job.attempts >= job.max_attempts;

    await supabase
      .from("job_queue")
      .update(
        isFinalAttempt
          ? { status: "failed", last_error: message }
          : { status: "queued", run_after: backoffRunAfter(job.attempts), last_error: message },
      )
      .eq("id", job.id);

    return false;
  }
}

Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  const supabase = getSupabaseServiceRoleClient();

  const { data: claimedJobs, error: claimError } = await supabase.rpc("claim_due_jobs", {
    p_job_types: Object.keys(HANDLERS),
    p_limit: BATCH_SIZE,
  });

  if (claimError) {
    return new Response(JSON.stringify({ error: `Failed to claim jobs: ${claimError.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jobs = (claimedJobs ?? []) as JobQueueRow[];

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const ok = await processJob(supabase, job);
    if (ok) succeeded += 1;
    else failed += 1;
  }

  return new Response(JSON.stringify({ claimed: jobs.length, succeeded, failed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
