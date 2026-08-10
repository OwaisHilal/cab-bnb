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

export function jsonValidationError(error: ZodError) {
  return NextResponse.json(
    { error: "Invalid request body", details: error.issues },
    { status: 400 },
  );
}
