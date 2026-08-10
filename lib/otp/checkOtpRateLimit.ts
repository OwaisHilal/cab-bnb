import type { SupabaseClient } from "@supabase/supabase-js";
import { OTP_RATE_LIMIT_MAX, OTP_RATE_LIMIT_WINDOW_MINUTES } from "./config";

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Checklist 2.3 / Plan §11: max OTP_RATE_LIMIT_MAX sends per phone number
 * within OTP_RATE_LIMIT_WINDOW_MINUTES. IP-based limiting from Plan §11 is
 * intentionally not implemented here — `otp_verifications` has no IP column,
 * and adding one is a schema change out of scope for this increment.
 */
export async function checkOtpRateLimit(supabase: SupabaseClient, phoneE164: string): Promise<void> {
  const windowStart = new Date(Date.now() - OTP_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("otp_verifications")
    .select("id", { count: "exact", head: true })
    .eq("phone_e164", phoneE164)
    .gte("created_at", windowStart);

  if (error) {
    throw new Error(`Failed to check OTP rate limit: ${error.message}`);
  }

  if ((count ?? 0) >= OTP_RATE_LIMIT_MAX) {
    throw new RateLimitError(
      `Too many OTP requests for this phone number. Try again after ${OTP_RATE_LIMIT_WINDOW_MINUTES} minutes.`,
    );
  }
}
