import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/**
 * Shared response envelope for app/api/* route handlers, so every Phase 2
 * route (Checklist 2.1 onward) returns errors and payloads consistently
 * instead of each route inlining its own NextResponse.json shape.
 */
export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Same envelope as jsonError, plus a stable machine-readable `code` (and
 * optional extra fields) so a client can branch on known error states
 * (e.g. "existing_driver_name_mismatch") instead of string-matching the
 * human-readable message. Additive — existing jsonError callers are
 * unaffected. See app/api/vendor/assign-driver/route.ts.
 */
export function jsonErrorCode(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, code, ...extra }, { status });
}

export function jsonValidationError(error: ZodError) {
  return NextResponse.json(
    { error: "Invalid request body", details: error.issues },
    { status: 400 },
  );
}
