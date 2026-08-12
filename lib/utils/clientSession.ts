const SESSION_STORAGE_KEY = "kmr_booking_session_id";

/**
 * OTP send/verify and the Phone.Email fallback all key off one `session_id`
 * per browser tab (app/api/otp/send, app/api/otp/verify,
 * app/api/otp/phone-email/verify) so completePhoneVerification can bind a
 * verification to the trip_request that created it. sessionStorage (not
 * localStorage) matches "per visit" semantics — a fresh tab gets a fresh
 * session rather than reusing a stale one from days ago.
 */
export function getOrCreateClientSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;

  const created = crypto.randomUUID();
  sessionStorage.setItem(SESSION_STORAGE_KEY, created);
  return created;
}
