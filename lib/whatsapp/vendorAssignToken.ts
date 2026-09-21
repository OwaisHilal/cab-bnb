import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Signed, expiring token embedded in the vendor "Assign driver" WhatsApp
 * CTA link (app/vendor/assign-driver). There is no vendor login/session
 * system in this repo — this is the only thing standing between that link
 * and the booking + vendor it points at, so it must be tamper-evident and
 * time-boxed. Same HMAC-SHA256 primitive already used for Cashfree webhook
 * signatures (lib/cashfree/pure.ts verifyCashfreeWebhookSignature), just
 * applied to a token this app mints itself instead of a third party's
 * webhook body. Mirrored (signing only) in
 * supabase/functions/_shared/vendorAssignToken.ts for the Edge Function
 * notify_vendor_booking handler — both must share the same
 * VENDOR_ASSIGN_SECRET value (Next env + `supabase secrets set`).
 */

export interface VendorAssignTokenPayload {
  bookingId: string
  vendorId: string
  exp: number
}

export type VerifyVendorAssignTokenResult =
  | { ok: true; payload: VendorAssignTokenPayload }
  | { ok: false; reason: "malformed" | "expired" | "invalid_signature" }

/** 72h — comfortably longer than VENDOR_DRIVER_DETAIL_SLA_MINUTES (default 30 min)
 * ops-alert escalation, so a slow-but-responsive vendor's link is still valid. */
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000

function requireSecret(): string {
  const secret = process.env.VENDOR_ASSIGN_SECRET
  if (!secret) {
    throw new Error("Missing VENDOR_ASSIGN_SECRET. Copy .env.example to .env.local and fill it in.")
  }
  return secret
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url")
}

/**
 * Signs `{ bookingId, vendorId, exp }` into a compact `payload.signature`
 * token. Callers still must confirm (after verifying) that the returned
 * vendorId matches the vendor replying, and that the booking is still in
 * an assignable state — this only proves the token itself wasn't
 * tampered with or has expired.
 */
export function signVendorAssignToken(input: {
  bookingId: string
  vendorId: string
  ttlMs?: number
}): string {
  const secret = requireSecret()
  const payload: VendorAssignTokenPayload = {
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    exp: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = signPayload(payloadB64, secret)
  return `${payloadB64}.${signature}`
}

export function verifyVendorAssignToken(token: string): VerifyVendorAssignTokenResult {
  const secret = requireSecret()
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" }
  const [payloadB64, signature] = parts

  const expectedSignature = signPayload(payloadB64, secret)
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return { ok: false, reason: "invalid_signature" }
  }

  let payload: VendorAssignTokenPayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as VendorAssignTokenPayload
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (
    typeof payload.bookingId !== "string" ||
    !payload.bookingId ||
    typeof payload.vendorId !== "string" ||
    !payload.vendorId ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" }
  }

  if (Date.now() > payload.exp) {
    return { ok: false, reason: "expired" }
  }

  return { ok: true, payload }
}
