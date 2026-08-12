import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { verifyPhoneEmailProof } from "@/lib/phone-email/verifyPhoneEmailProof";
import { completePhoneVerification } from "@/lib/otp/completePhoneVerification";

const providerPayloadSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("user_json_url"), user_json_url: z.string().min(1) }),
  z.object({ mode: z.literal("user_info"), user_info: z.unknown() }),
]);

const phoneEmailVerifySchema = z.object({
  session_id: z.string().min(1),
  trip_request_id: z.string().uuid(),
  provider_payload: providerPayloadSchema,
});

/**
 * Provider-neutral fallback verification path (Plan §3): the frontend only
 * ever forwards Phone.Email's provider proof here, never a phone number it
 * read itself. This route validates that proof server-side, then reuses
 * the same completion step as the primary WhatsApp OTP flow so both paths
 * stay identical past the point of "who verified the phone number."
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = phoneEmailVerifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonValidationError(parsed.error);
  }

  const { session_id, trip_request_id, provider_payload } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const proofResult = await verifyPhoneEmailProof(provider_payload);
  if (!proofResult.ok) {
    return jsonError(proofResult.status, proofResult.message);
  }

  const completionResult = await completePhoneVerification({
    supabase,
    sessionId: session_id,
    phoneE164: proofResult.user.phoneE164,
    tripRequestId: trip_request_id,
    verifiedBy: "phone_email",
  });

  if (!completionResult.ok) {
    return jsonError(completionResult.status, completionResult.message);
  }

  return jsonOk({
    verified: true,
    channel: "phone_email" as const,
    phone_e164: proofResult.user.phoneE164,
    trip_request_id,
  });
}
