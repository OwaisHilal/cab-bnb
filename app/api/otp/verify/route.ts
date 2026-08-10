import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { OTP_CODE_LENGTH, OTP_MAX_ATTEMPTS } from "@/lib/otp/config";
import { verifyOtpCode } from "@/lib/otp/hashOtpCode";

const otpVerifySchema = z.object({
  session_id: z.string().min(1),
  phone_e164: z.string().min(1),
  otp_code: z.string().length(OTP_CODE_LENGTH).regex(/^\d+$/, "otp_code must be numeric"),
  // Checklist 2.4's body spec omits this, but Plan §5 step 5 needs to know
  // which trip_request to link tourist_id on — see the plan's documented
  // assumption. The frontend already has this from the 2.1 response.
  trip_request_id: z.string().uuid(),
});

/**
 * Checklist 2.4: verify OTP, upsert tourist, link trip_request, enqueue
 * send_quotes job (Plan §5 step 5). No inline WhatsApp send here — the
 * job_queue row is picked up by a worker in a later increment (Checklist
 * 2.8 / 3.10).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = otpVerifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonValidationError(parsed.error);
  }

  const { session_id, phone_e164, otp_code, trip_request_id } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data: otpRow, error: otpFetchError } = await supabase
    .from("otp_verifications")
    .select("id, otp_code_hash, attempts")
    .eq("session_id", session_id)
    .eq("phone_e164", phone_e164)
    .eq("verified", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (otpFetchError) {
    return jsonError(500, `Failed to fetch OTP: ${otpFetchError.message}`);
  }
  if (!otpRow) {
    return jsonError(404, "No pending OTP found for this phone number and session. Request a new one.");
  }
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
    return jsonError(429, "Too many incorrect attempts. Request a new OTP.");
  }

  const isMatch = await verifyOtpCode(otp_code, otpRow.otp_code_hash);

  if (!isMatch) {
    const { error: attemptsUpdateError } = await supabase
      .from("otp_verifications")
      .update({ attempts: otpRow.attempts + 1 })
      .eq("id", otpRow.id);

    if (attemptsUpdateError) {
      return jsonError(500, `Failed to record OTP attempt: ${attemptsUpdateError.message}`);
    }

    return jsonError(400, "Incorrect OTP");
  }

  const { data: tripRequest, error: tripRequestError } = await supabase
    .from("trip_requests")
    .select("id")
    .eq("id", trip_request_id)
    .maybeSingle();

  if (tripRequestError) {
    return jsonError(500, `Failed to fetch trip request: ${tripRequestError.message}`);
  }
  if (!tripRequest) {
    return jsonError(404, `trip_request ${trip_request_id} not found`);
  }

  const { error: otpVerifiedUpdateError } = await supabase
    .from("otp_verifications")
    .update({ verified: true })
    .eq("id", otpRow.id);

  if (otpVerifiedUpdateError) {
    return jsonError(500, `Failed to mark OTP verified: ${otpVerifiedUpdateError.message}`);
  }

  const { data: tourist, error: touristUpsertError } = await supabase
    .from("tourists")
    .upsert({ phone_e164 }, { onConflict: "phone_e164" })
    .select("id")
    .single();

  if (touristUpsertError || !tourist) {
    return jsonError(500, `Failed to upsert tourist: ${touristUpsertError?.message ?? "unknown error"}`);
  }

  const { error: tripRequestUpdateError } = await supabase
    .from("trip_requests")
    .update({ tourist_id: tourist.id, status: "otp_pending" })
    .eq("id", trip_request_id);

  if (tripRequestUpdateError) {
    return jsonError(500, `Failed to link trip request: ${tripRequestUpdateError.message}`);
  }

  const { error: jobEnqueueError } = await supabase.from("job_queue").insert({
    job_type: "send_quotes",
    payload: { trip_request_id },
  });

  if (jobEnqueueError) {
    return jsonError(500, `Failed to enqueue send_quotes job: ${jobEnqueueError.message}`);
  }

  return jsonOk({ verified: true, trip_request_id });
}
