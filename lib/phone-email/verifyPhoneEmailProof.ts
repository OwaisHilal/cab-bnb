import "server-only";
import type { PhoneEmailVerificationPayload, VerifyPhoneEmailProofResult } from "./types";

const DEFAULT_ALLOWED_HOST = "user.phone.email";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Server-only allowlist for the `user_json_url` Phone.Email hands back to
 * the frontend. Fetching an arbitrary client-supplied URL server-side is an
 * SSRF vector, so this is intentionally not user-configurable in
 * production — only a server env var (never NEXT_PUBLIC_) can override it,
 * and only for test/staging Phone.Email environments.
 */
function getAllowedUserJsonHost(): string {
  return process.env.PHONE_EMAIL_USER_JSON_ALLOWED_HOST || DEFAULT_ALLOWED_HOST;
}

function validateUserJsonUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, message: "user_json_url is not a valid URL" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, message: "user_json_url must use https" };
  }

  if (url.username || url.password) {
    return { ok: false, message: "user_json_url must not contain credentials" };
  }

  const allowedHost = getAllowedUserJsonHost();
  if (url.hostname !== allowedHost) {
    return { ok: false, message: `user_json_url host must be ${allowedHost}` };
  }

  return { ok: true, url };
}

/**
 * Phone.Email's generated-button flow returns a `user_json_url` whose JSON
 * body it documents as containing `user_country_code`, `user_phone_number`,
 * `user_first_name`, and `user_last_name`. We fetch it server-side (never
 * trusting a phone number reported directly by the browser) and normalize
 * it to E.164.
 */
async function verifyViaUserJsonUrl(userJsonUrl: string): Promise<VerifyPhoneEmailProofResult> {
  const validation = validateUserJsonUrl(userJsonUrl);
  if (!validation.ok) {
    return { ok: false, status: 400, message: validation.message };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(validation.url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      message: `Failed to reach Phone.Email verification endpoint: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return { ok: false, status: 502, message: `Phone.Email verification endpoint returned ${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 502, message: "Phone.Email verification endpoint returned invalid JSON" };
  }

  if (typeof payload !== "object" || payload === null) {
    return { ok: false, status: 502, message: "Phone.Email verification endpoint returned an unexpected payload" };
  }

  const record = payload as Record<string, unknown>;
  const countryCode = record.user_country_code;
  const phoneNumber = record.user_phone_number;

  if (typeof countryCode !== "string" || !countryCode.trim() || typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    return { ok: false, status: 502, message: "Phone.Email verification endpoint is missing phone number fields" };
  }

  const normalizedCountryCode = countryCode.replace(/[^\d]/g, "");
  const normalizedPhoneNumber = phoneNumber.replace(/[^\d]/g, "");

  if (!normalizedCountryCode || !normalizedPhoneNumber) {
    return { ok: false, status: 502, message: "Phone.Email verification endpoint returned an unparseable phone number" };
  }

  const phoneE164 = `+${normalizedCountryCode}${normalizedPhoneNumber}`;
  const firstName = typeof record.user_first_name === "string" ? record.user_first_name : undefined;
  const lastName = typeof record.user_last_name === "string" ? record.user_last_name : undefined;

  return {
    ok: true,
    user: { phoneE164, firstName, lastName },
  };
}

/**
 * The React `phone-email-auth` / `clientId` flow's `userInfo` contract has
 * not been confirmed against TL-provided dashboard configuration yet (Plan
 * §3). Trusting an unverified client-side payload here would let a caller
 * claim any phone number, so this branch stays a controlled "not yet
 * supported" response rather than a guess at the real contract.
 */
function verifyViaUserInfo(): VerifyPhoneEmailProofResult {
  return {
    ok: false,
    status: 501,
    message: "Phone.Email user_info verification is not yet configured for this environment",
  };
}

export async function verifyPhoneEmailProof(
  payload: PhoneEmailVerificationPayload,
): Promise<VerifyPhoneEmailProofResult> {
  if (payload.mode === "user_json_url") {
    return verifyViaUserJsonUrl(payload.user_json_url);
  }
  return verifyViaUserInfo();
}
