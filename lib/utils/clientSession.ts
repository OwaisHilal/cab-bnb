const SESSION_STORAGE_KEY = "kmr_booking_session_id";

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Session id carried on a Cashfree return (`?continue=1&sid=`). A bare `?sid=`
 * must not replace this tab's session, and anything that is not a UUID is ignored.
 */
export function sessionIdToAdopt(continueRequested: boolean, sid: string | null): string | null {
  if (!continueRequested || !sid || !SESSION_ID_PATTERN.test(sid)) return null;
  return sid;
}

/**
 * Writes a known session id into this tab. Invalid ids fall back to the
 * tab's own id. Storage failures still return a usable id for this page load.
 */
export function adoptClientSessionId(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    try {
      return getOrCreateClientSessionId();
    } catch {
      return crypto.randomUUID();
    }
  }
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Storage unavailable — the id is still valid for this page load.
  }
  return sessionId;
}

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

/** Drops the tab session id — next getOrCreateClientSessionId() mints a new one. */
export function clearClientSessionId(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

/** Clears any stored session id and returns a freshly minted one. */
export function resetClientSessionId(): string {
  clearClientSessionId();
  return getOrCreateClientSessionId();
}
