import type { VehicleTypeCode } from "@/features/booking-request/types";

/**
 * The Phone.Email fallback now redirects the whole tab away and back
 * (features/phone-email/components/PhoneEmailAdapter.tsx,
 * app/phone-email/callback/page.tsx) rather than using a popup, so the
 * running features/booking-request/hooks/useBookingFlow.ts instance is
 * gone by the time the user returns. This is the shared sessionStorage
 * contract both sides use to hand off just enough state to resume: what
 * trip request to finish verifying, and what to show once it's done.
 */
export interface PhoneEmailResumePayload {
  tripRequestId: string;
  days: number;
  paxCount: number;
  vehicleType: VehicleTypeCode;
}

const PENDING_KEY = "kmr_phone_email_pending";
const VERIFIED_KEY = "kmr_phone_email_verified";
const VEHICLE_TYPE_CODES: readonly VehicleTypeCode[] = ["sedan", "suv", "tempo"];

function isPhoneEmailResumePayload(value: unknown): value is PhoneEmailResumePayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tripRequestId === "string" &&
    record.tripRequestId.length > 0 &&
    typeof record.days === "number" &&
    typeof record.paxCount === "number" &&
    typeof record.vehicleType === "string" &&
    (VEHICLE_TYPE_CODES as readonly string[]).includes(record.vehicleType)
  );
}

function readAndClear(key: string): PhoneEmailResumePayload | null {
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return isPhoneEmailResumePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Written right before the tab navigates away to Phone.Email. */
export function writePendingPhoneEmailResume(payload: PhoneEmailResumePayload): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
}

/** Consumed once by the callback page after it returns from Phone.Email. */
export function readAndClearPendingPhoneEmailResume(): PhoneEmailResumePayload | null {
  return readAndClear(PENDING_KEY);
}

/** Written by the callback page only after the backend confirms verification. */
export function writeVerifiedPhoneEmailResume(payload: PhoneEmailResumePayload): void {
  sessionStorage.setItem(VERIFIED_KEY, JSON.stringify(payload));
}

/**
 * Non-destructive read, used to seed useBookingFlow's initial React state
 * via useState lazy initializers. Deliberately not "read-and-clear": React
 * (Strict Mode, dev only) double-invokes lazy initializers, and a
 * destructive read there would make the second invocation see nothing.
 * Pair with clearVerifiedPhoneEmailResume() in an effect instead, since
 * sessionStorage.removeItem is idempotent and safe to run twice.
 */
export function peekVerifiedPhoneEmailResume(): PhoneEmailResumePayload | null {
  const raw = sessionStorage.getItem(VERIFIED_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return isPhoneEmailResumePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearVerifiedPhoneEmailResume(): void {
  sessionStorage.removeItem(VERIFIED_KEY);
}
