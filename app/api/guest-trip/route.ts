import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { loadGuestTrip, type GuestConfirming } from "@/lib/guest-trip/loadGuestTrip";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const readConfirming = (value: string | null): GuestConfirming => {
  if (value === "token" || value === "balance") return value;
  return null;
};

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim() ?? "";
  if (!sessionId) return jsonError(400, "session_id is required");

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  try {
    const snapshot = await loadGuestTrip(supabase, {
      sessionId,
      confirming: readConfirming(request.nextUrl.searchParams.get("confirming")),
    });
    if (!snapshot) return jsonError(404, "No trip for this session");
    return jsonOk(snapshot);
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to load trip");
  }
}
