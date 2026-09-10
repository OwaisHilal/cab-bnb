import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleSendQuotes } from "../_shared/handlers/sendQuotes.ts";
import { handleComputeNegotiation } from "../_shared/handlers/computeNegotiation.ts";
import { handleFinalizeBooking } from "../_shared/handlers/finalizeBooking.ts";
import { handleSendTokenPaymentLink } from "../_shared/handlers/sendTokenPaymentLink.ts";
import { handleSendTokenReceivedAck } from "../_shared/handlers/sendTokenReceivedAck.ts";
import { handleNotifyVendorBooking } from "../_shared/handlers/notifyVendorBooking.ts";
import { handleParseDriverDetails } from "../_shared/handlers/parseDriverDetails.ts";
import { handleSendBalancePayment } from "../_shared/handlers/sendBalancePayment.ts";
import { handleCompleteBalancePayment } from "../_shared/handlers/completeBalancePayment.ts";
import { handleSendConfirmationCard } from "../_shared/handlers/sendConfirmationCard.ts";
import { handleCreateRideGroup } from "../_shared/handlers/createRideGroup.ts";
import { handleRemindRideGroupJoin } from "../_shared/handlers/remindRideGroupJoin.ts";
import { handleDeleteRideGroup } from "../_shared/handlers/deleteRideGroup.ts";
import { handleDispatchLifecycleEvents } from "../_shared/handlers/dispatchLifecycleEvents.ts";
import { handleExpireStaleQuotes } from "../_shared/handlers/expireStaleQuotes.ts";
import { handleRecordLifecycleResponse } from "../_shared/handlers/recordLifecycleResponse.ts";
import { handleOpsAlert } from "../_shared/handlers/opsAlert.ts";
import { handleRecordReview } from "../_shared/handlers/recordReview.ts";
import { handleVendorReplyTimeouts } from "../_shared/handlers/vendorReplyTimeouts.ts";

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
 * Checklist 3.10: central job_queue dispatcher. Invoked on demand from
 * Next.js `drainDueJobs` (webhook/OTP/admin), by an INSERT trigger via
 * pg_net, and every 1 min by pg_cron. Registers a handler for every
 * job_type currently enqueued anywhere in the app (WhatsApp webhook,
 * `finalize_quote_booking` RPC, admin driver-details correction
 * route) — anything with no registered handler is left `queued` untouched
 * rather than mis-marked as failed.
 *
 * Checklist 3.1/3.3/3.4 compatibility note: `match-vendor-rate-bands`
 * stays as the colocated `lib/matching/matchVendorRateBands.ts` server
 * function (Checklist 3.1 explicitly allows "direct SQL if colocated").
 * `compute-negotiation` and `finalize-booking` are implemented through
 * this worker's shared handlers plus locked Postgres RPCs (migration
 * 0009) rather than as separate always-standalone-invoked function
 * folders — functionally equivalent for every caller that matters
 * (this worker and the webhook-enqueued jobs it processes), so no rework
 * was needed there for this phase.
 *
 * `dispatch_lifecycle_events`/`expire_stale_quotes`/`vendor_reply_timeouts`
 * are scheduled by pg_cron (and a daily Vercel Cron safety net) via their
 * own Edge Function + Next cron route rather than through `job_queue` —
 * they're still registered here so a manually-enqueued job of any of
 * those types is also handled.
 */
const HANDLERS: Record<string, (supabase: SupabaseClient, payload: Record<string, unknown>) => Promise<void>> = {
  send_quotes: (supabase, payload) =>
    handleSendQuotes(supabase, payload as unknown as { trip_request_id: string }),
  compute_negotiation: (supabase, payload) =>
    handleComputeNegotiation(supabase, payload as unknown as { quote_snapshot_id: string }),
  finalize_booking: (supabase, payload) =>
    handleFinalizeBooking(supabase, payload as unknown as { quote_snapshot_id: string; lock_type: "full_payment" | "token_99" }),
  send_token_payment_link: (supabase, payload) =>
    handleSendTokenPaymentLink(supabase, payload as unknown as { quote_snapshot_id: string }),
  send_token_received_ack: (supabase, payload) =>
    handleSendTokenReceivedAck(supabase, payload as unknown as { booking_id: string }),
  notify_vendor_booking: (supabase, payload) =>
    handleNotifyVendorBooking(supabase, payload as unknown as { booking_id: string }),
  parse_driver_details: (supabase, payload) =>
    handleParseDriverDetails(
      supabase,
      payload as unknown as { raw_message_text: string; from_phone: string; wa_message_id?: string },
    ),
  send_confirmation_card: (supabase, payload) =>
    handleSendConfirmationCard(supabase, payload as unknown as { booking_id: string }),
  send_balance_payment: (supabase, payload) =>
    handleSendBalancePayment(supabase, payload as unknown as { booking_id: string }),
  complete_balance_payment: (supabase, payload) =>
    handleCompleteBalancePayment(
      supabase,
      payload as unknown as { booking_id: string; wa_message_id?: string },
    ),
  create_ride_group: (supabase, payload) =>
    handleCreateRideGroup(supabase, payload as unknown as { booking_id: string }),
  remind_ride_group_join: (supabase, payload) =>
    handleRemindRideGroupJoin(supabase, payload as unknown as { booking_id: string }),
  delete_ride_group: (supabase, payload) =>
    handleDeleteRideGroup(supabase, payload as unknown as { booking_id: string }),
  dispatch_lifecycle_events: (supabase) => handleDispatchLifecycleEvents(supabase).then(() => undefined),
  expire_stale_quotes: (supabase) => handleExpireStaleQuotes(supabase).then(() => undefined),
  record_lifecycle_response: (supabase, payload) =>
    handleRecordLifecycleResponse(
      supabase,
      payload as unknown as { lifecycle_event_id: string; response: "ok" | "help_requested" },
    ),
  ops_alert: (supabase, payload) => handleOpsAlert(supabase, payload),
  record_review: (supabase, payload) =>
    handleRecordReview(supabase, payload as unknown as { booking_id: string; rating: number }),
  vendor_reply_timeouts: (supabase) => handleVendorReplyTimeouts(supabase).then(() => undefined),
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
