import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import {
  clearCustomerSessionCookie,
  readCustomerSessionFromRequest,
} from "@/lib/auth/customerSession";
import { findCurrentGuestTrip, rememberGuestSession } from "@/lib/guest-trip/findCurrentGuestTrip";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Phone Session Login plan — hydration endpoint. The durable login cookie
 * (lib/auth/customerSession.ts) identifies a tourist across tabs/devices,
 * but the existing guest-trip APIs (app/api/guest-trip/**) still key off
 * the per-tab `session_id`. This route is the bridge: given a valid
 * session cookie and the caller's current tab `session_id`, it links that
 * tab to the tourist's current trip (via guest_trip_sessions, same table
 * the OTP/Phone.Email verify routes already write to) so the existing
 * fetchGuestTrip(sessionId, ...) call on the client resolves it. Current
 * trip only, per the approved scope — no booking history is restored here.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim() || null;

  const session = await readCustomerSessionFromRequest(request);
  if (!session) {
    return jsonOk({ authenticated: false as const });
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  try {
    const currentTrip = await findCurrentGuestTrip(supabase, session.touristId);

    if (currentTrip && sessionId) {
      // Best-effort: a device that hasn't verified anything yet (missing
      // migration, race, etc.) still gets `authenticated: true` back, just
      // without tripRequestId — the client falls back to showing the
      // logged-in profile without an active trip rather than failing.
      await rememberGuestSession(supabase, sessionId, currentTrip.id);
    }

    return jsonOk({
      authenticated: true as const,
      touristId: session.touristId,
      phoneE164: session.phoneE164,
      tripRequestId: currentTrip?.id ?? null,
    });
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to load session");
  }
}

const deleteSchema = z.object({
  session_id: z.string().min(1).optional(),
});

/**
 * Signs out of the durable login only. Deliberately does not touch
 * trip_requests or bookings — "Sign out" and "Cancel booking"
 * (app/api/guest-trip/cancel) are different actions; cancelling must stay
 * an explicit, separate choice.
 */
export async function DELETE(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = deleteSchema.safeParse(body ?? {});
  if (!parsed.success) return jsonValidationError(parsed.error);

  const sessionId = parsed.data.session_id;
  if (sessionId) {
    try {
      const supabase = getSupabaseServiceRoleClient();
      // Best-effort cleanup of this tab's trip link; a missing table or
      // row is not an error — the tab is getting a brand-new session id
      // right after this call anyway (useBookingFlow.clearBooking).
      await supabase.from("guest_trip_sessions").delete().eq("session_id", sessionId);
    } catch {
      // Supabase not configured, or guest_trip_sessions missing — sign-out
      // must still succeed from the client's point of view.
    }
  }

  const response = jsonOk({ ok: true });
  clearCustomerSessionCookie(response);
  return response;
}
