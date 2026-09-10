import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { handleSendTokenPaymentLink } from "@/lib/whatsapp/sendTokenPaymentLink"
import { handleFinalizeBooking } from "@/lib/whatsapp/finalizeBooking"
import { handleSendTokenReceivedAck } from "@/lib/whatsapp/sendTokenReceivedAck"
import { handleNotifyVendorBooking } from "@/lib/whatsapp/notifyVendorBooking"
import { handleParseDriverDetails } from "@/lib/whatsapp/parseDriverDetails"
import { handleSendBalancePayment } from "@/lib/whatsapp/sendBalancePaymentLink"
import { handleCompleteBalancePayment } from "@/lib/whatsapp/completeBalancePayment"
import { handleCreateRideGroup } from "@/lib/whatsapp/createRideGroup"
import { handleRemindRideGroupJoin } from "@/lib/whatsapp/remindRideGroupJoin"
import { handleDeleteRideGroup } from "@/lib/whatsapp/deleteRideGroup"
import { handleSendQuotes } from "@/lib/jobs/handleSendQuotes"
import { SEND_QUOTES_JOB_TYPE } from "@/lib/jobs/localJobHandlerTypes"

const BATCH_SIZE = 20
const MAX_BACKOFF_MINUTES = 60

interface JobQueueRow {
  id: string
  job_type: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

const LOCAL_HANDLERS: Record<
  string,
  (supabase: SupabaseClient, payload: Record<string, unknown>) => Promise<void>
> = {
  [SEND_QUOTES_JOB_TYPE]: (supabase, payload) =>
    handleSendQuotes(supabase, payload as { trip_request_id?: string }),
  send_token_payment_link: (supabase, payload) =>
    handleSendTokenPaymentLink(supabase, payload as { quote_snapshot_id: string }),
  finalize_booking: (supabase, payload) =>
    handleFinalizeBooking(
      supabase,
      payload as { quote_snapshot_id: string; lock_type: "full_payment" | "token_99" },
    ),
  send_token_received_ack: (supabase, payload) =>
    handleSendTokenReceivedAck(supabase, payload as { booking_id: string }),
  notify_vendor_booking: (supabase, payload) =>
    handleNotifyVendorBooking(supabase, payload as { booking_id: string }),
  parse_driver_details: (supabase, payload) =>
    handleParseDriverDetails(
      supabase,
      payload as { raw_message_text: string; from_phone: string; wa_message_id?: string },
    ),
  send_balance_payment: (supabase, payload) =>
    handleSendBalancePayment(supabase, payload as { booking_id: string }),
  complete_balance_payment: (supabase, payload) =>
    handleCompleteBalancePayment(supabase, payload as { booking_id: string; wa_message_id?: string }),
  create_ride_group: (supabase, payload) =>
    handleCreateRideGroup(supabase, payload as { booking_id: string }),
  remind_ride_group_join: (supabase, payload) =>
    handleRemindRideGroupJoin(supabase, payload as { booking_id: string }),
  delete_ride_group: (supabase, payload) =>
    handleDeleteRideGroup(supabase, payload as { booking_id: string }),
}

const backoffRunAfter = (attempts: number): string => {
  const minutes = Math.min(2 ** attempts, MAX_BACKOFF_MINUTES)
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

/**
 * Next fallback when `job-queue-worker` is not deployed. Claims one batch
 * of due `job_queue` rows (FIFO among `run_after <= now()`), then runs the
 * local handlers. Callers that enqueue work should use `drainDueJobs`,
 * which loops this until the queue is quiet.
 */
export const processDueJobs = async (
  supabase: SupabaseClient,
  options?: { jobTypes?: string[]; limit?: number },
): Promise<{ claimed: number; succeeded: number; failed: number }> => {
  const jobTypes = options?.jobTypes ?? Object.keys(LOCAL_HANDLERS)
  const { data: claimedJobs, error: claimError } = await supabase.rpc("claim_due_jobs", {
    p_job_types: jobTypes,
    p_limit: options?.limit ?? BATCH_SIZE,
  })

  if (claimError) {
    throw new Error(`Failed to claim jobs: ${claimError.message}`)
  }

  const jobs = (claimedJobs ?? []) as JobQueueRow[]
  let succeeded = 0
  let failed = 0

  for (const job of jobs) {
    const handler = LOCAL_HANDLERS[job.job_type]
    try {
      if (!handler) throw new Error(`No local handler for job_type "${job.job_type}"`)
      await handler(supabase, job.payload ?? {})
      await supabase.from("job_queue").update({ status: "done" }).eq("id", job.id)
      succeeded += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job error"
      const isFinalAttempt = job.attempts >= job.max_attempts
      await supabase
        .from("job_queue")
        .update(
          isFinalAttempt
            ? { status: "failed", last_error: message }
            : { status: "queued", run_after: backoffRunAfter(job.attempts), last_error: message },
        )
        .eq("id", job.id)
      failed += 1
    }
  }

  return { claimed: jobs.length, succeeded, failed }
}
