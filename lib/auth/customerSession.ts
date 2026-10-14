import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Durable phone-based login session (Phone Session Login plan), separate
 * from the per-tab `session_id` in lib/utils/clientSession.ts. That tab id
 * stays the device/flow id used by OTP, trip creation, and
 * guest_trip_sessions; this cookie is the thing that lets a tourist stay
 * signed in across refreshes, new tabs, and new browser sessions for up to
 * CUSTOMER_SESSION_TTL_SECONDS without OTPing again. Minted only after a
 * real OTP-code or Phone.Email verification succeeds
 * (lib/otp/completePhoneVerification.ts) — never minted from client input
 * alone.
 */

export const CUSTOMER_SESSION_COOKIE_NAME = "kmr_customer_session";

/** 7 days, per the approved session design. */
export const CUSTOMER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface CustomerSessionPayload {
  touristId: string;
  phoneE164: string;
}

function isCustomerSessionPayload(value: unknown): value is CustomerSessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.touristId === "string" &&
    record.touristId.length > 0 &&
    typeof record.phoneE164 === "string" &&
    record.phoneE164.length > 0
  );
}

function getSessionSecretKey(): Uint8Array {
  const secret = process.env.CUSTOMER_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "Missing CUSTOMER_SESSION_SECRET. Copy .env.example to .env.local and fill in a long random value.",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Signs a compact HS256 JWT carrying only `touristId` + `phoneE164` — no
 * PII beyond the phone number this flow already verified, and nothing a
 * client could use to mint its own session (the secret never reaches the
 * browser).
 */
export async function createCustomerSessionToken(payload: CustomerSessionPayload): Promise<string> {
  const secretKey = getSessionSecretKey();
  return new SignJWT({ touristId: payload.touristId, phoneE164: payload.phoneE164 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CUSTOMER_SESSION_TTL_SECONDS}s`)
    .sign(secretKey);
}

/**
 * Verifies signature + expiry and shape. Returns null (never throws) for
 * any failure mode — malformed, expired, tampered, or signed with a
 * different/rotated secret — so callers can uniformly treat "no valid
 * session" the same as "no cookie" and fall back to guest/OTP behavior.
 */
export async function verifyCustomerSessionToken(token: string): Promise<CustomerSessionPayload | null> {
  try {
    const secretKey = getSessionSecretKey();
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    if (!isCustomerSessionPayload(payload)) return null;
    return { touristId: payload.touristId, phoneE164: payload.phoneE164 };
  } catch {
    return null;
  }
}

/** Reads and verifies the session cookie off an incoming request. */
export async function readCustomerSessionFromRequest(
  request: NextRequest,
): Promise<CustomerSessionPayload | null> {
  const token = request.cookies.get(CUSTOMER_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyCustomerSessionToken(token);
}

/**
 * httpOnly + secure (outside local dev) + sameSite=lax: unreadable by
 * client JS, not sent cross-site, but still sent on top-level navigations
 * like the Phone.Email full-redirect round trip
 * (lib/phone-email/resumeState.ts) and the /pay/token/[crqid] page.
 */
export async function setCustomerSessionCookie(
  response: NextResponse,
  payload: CustomerSessionPayload,
): Promise<void> {
  const token = await createCustomerSessionToken(payload);
  response.cookies.set({
    name: CUSTOMER_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CUSTOMER_SESSION_TTL_SECONDS,
  });
}

/** Signs the user out of the durable session. Never touches trip data. */
export function clearCustomerSessionCookie(response: NextResponse): void {
  response.cookies.delete(CUSTOMER_SESSION_COOKIE_NAME);
}
