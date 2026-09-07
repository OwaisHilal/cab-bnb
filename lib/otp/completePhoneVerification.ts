import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processDueJobs } from "@/lib/jobs/processDueJobs";
import { SEND_QUOTES_JOB_TYPE } from "@/lib/jobs/localJobHandlerTypes";

/**
 * Both the OTP-code path (app/api/otp/verify/route.ts) and the Phone.Email
 * fallback path (app/api/otp/phone-email/verify/route.ts) end up doing the
 * exact same post-verification work: link the tourist to the trip request
 * and enqueue `send_quotes` (Plan §5 step 5). This is that shared step so
 * the two routes can't drift on tourist-upsert, session binding, or
 * duplicate-job logic.
 */
export type PhoneVerificationSource = "otp_code" | "phone_email";

export interface CompletePhoneVerificationInput {
  supabase: SupabaseClient;
  sessionId: string;
  phoneE164: string;
  tripRequestId: string;
  verifiedBy: PhoneVerificationSource;
}

export type CompletePhoneVerificationResult =
  | { ok: true; touristId: string }
  | { ok: false; status: number; message: string };

/**
 * Only trip_requests still awaiting their first OTP-driven quote send
 * should get a fresh `send_quotes` job here. If a trip_request has already
 * moved past this stage (quotes_sent, negotiating, booked, etc.) — e.g. a
 * duplicate verify submission racing a first successful one — skip the
 * enqueue rather than firing a second send_quotes job for the same trip.
 */
const QUOTE_JOB_ELIGIBLE_STATUSES = new Set(["quotes_ready", "otp_pending"]);

export async function completePhoneVerification(
  input: CompletePhoneVerificationInput,
): Promise<CompletePhoneVerificationResult> {
  const { supabase, sessionId, phoneE164, tripRequestId, verifiedBy } = input;

  const { data: tripRequest, error: tripRequestError } = await supabase
    .from("trip_requests")
    .select("id, session_id, status")
    .eq("id", tripRequestId)
    .maybeSingle();

  if (tripRequestError) {
    return { ok: false, status: 500, message: `Failed to fetch trip request: ${tripRequestError.message}` };
  }
  if (!tripRequest) {
    return { ok: false, status: 404, message: `trip_request ${tripRequestId} not found` };
  }

  // Closes a trust gap: without this, a valid OTP/Phone.Email verification
  // for phone A's session could be replayed against any other session's
  // trip_request_id, linking the wrong tourist to it.
  if (tripRequest.session_id !== sessionId) {
    return { ok: false, status: 403, message: "trip_request does not belong to this session" };
  }

  const { data: tourist, error: touristUpsertError } = await supabase
    .from("tourists")
    .upsert({ phone_e164: phoneE164 }, { onConflict: "phone_e164" })
    .select("id")
    .single();

  if (touristUpsertError || !tourist) {
    return {
      ok: false,
      status: 500,
      message: `Failed to upsert tourist: ${touristUpsertError?.message ?? "unknown error"}`,
    };
  }

  // A duplicate or late verification (e.g. a replayed OTP submit, or
  // Phone.Email finishing after the OTP-code path already advanced this
  // trip_request) must never push status back to `otp_pending` once it
  // has moved on to quotes_sent/negotiating/booked/etc. Only advance the
  // status when it's still in a pre-send state; always link the tourist.
  const shouldAdvanceToOtpPending = QUOTE_JOB_ELIGIBLE_STATUSES.has(tripRequest.status);

  const { error: tripRequestUpdateError } = await supabase
    .from("trip_requests")
    .update(
      shouldAdvanceToOtpPending
        ? { tourist_id: tourist.id, status: "otp_pending" }
        : { tourist_id: tourist.id },
    )
    .eq("id", tripRequestId);

  if (tripRequestUpdateError) {
    return { ok: false, status: 500, message: `Failed to link trip request: ${tripRequestUpdateError.message}` };
  }

  if (shouldAdvanceToOtpPending) {
    const { error: jobEnqueueError } = await supabase.from("job_queue").insert({
      job_type: "send_quotes",
      payload: { trip_request_id: tripRequestId, verified_by: verifiedBy },
    });

    if (jobEnqueueError) {
      return { ok: false, status: 500, message: `Failed to enqueue send_quotes job: ${jobEnqueueError.message}` };
    }

    try {
      const jobs = await processDueJobs(supabase, { jobTypes: [SEND_QUOTES_JOB_TYPE] });
      console.info("[quotes send] jobs", jobs);
    } catch (error) {
      console.info(
        "[quotes send] process failed",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  return { ok: true, touristId: tourist.id as string };
}
