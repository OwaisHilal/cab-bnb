import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const QUOTE_EXPIRY_HOURS_DEFAULT = 48;

// `viewed`/`negotiating` both indicate the customer already engaged with a
// quote, so they're treated as "has a response" and left alone — only
// `pending_send` (send never even completed) and `sent` (delivered, no
// interaction) count as "no response" (Plan §9/§14 documented assumption).
const NON_RESPONSE_SNAPSHOT_STATUSES = ["pending_send", "sent"];
const NON_TERMINAL_SNAPSHOT_STATUSES = ["pending_send", "sent", "viewed", "negotiating"];
const NON_TERMINAL_TRIP_REQUEST_STATUSES = ["matching", "quotes_ready", "otp_pending", "quotes_sent", "negotiating"];

interface ExpiredSnapshotRow {
  id: string;
  trip_request_id: string;
}

/**
 * Checklist 3.9 / Plan §9: expires `quote_snapshots` with no customer
 * response after `QUOTE_EXPIRY_HOURS` (default 48h), then expires the
 * parent `trip_request` only once every sibling snapshot has reached a
 * terminal state and the trip hasn't already been booked.
 */
export async function handleExpireStaleQuotes(
  supabase: SupabaseClient,
): Promise<{ expiredSnapshots: number; expiredTripRequests: number }> {
  const hours = Number(Deno.env.get("QUOTE_EXPIRY_HOURS")) || QUOTE_EXPIRY_HOURS_DEFAULT;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data: expiredSnapshots, error: expireError } = await supabase
    .from("quote_snapshots")
    .update({ status: "expired" })
    .in("status", NON_RESPONSE_SNAPSHOT_STATUSES)
    .lte("created_at", cutoff)
    .select("id, trip_request_id");

  if (expireError) throw new Error(`Failed to expire stale quote snapshots: ${expireError.message}`);

  const affectedTripRequestIds = Array.from(
    new Set((expiredSnapshots as ExpiredSnapshotRow[] | null ?? []).map((row) => row.trip_request_id)),
  );

  let expiredTripRequests = 0;

  for (const tripRequestId of affectedTripRequestIds) {
    const { count, error: remainingError } = await supabase
      .from("quote_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("trip_request_id", tripRequestId)
      .in("status", NON_TERMINAL_SNAPSHOT_STATUSES);

    if (remainingError) throw new Error(`Failed to check remaining quote snapshots: ${remainingError.message}`);
    if ((count ?? 0) > 0) continue;

    const { data: updatedTrip, error: tripUpdateError } = await supabase
      .from("trip_requests")
      .update({ status: "expired" })
      .eq("id", tripRequestId)
      .in("status", NON_TERMINAL_TRIP_REQUEST_STATUSES)
      .select("id");

    if (tripUpdateError) throw new Error(`Failed to expire trip request: ${tripUpdateError.message}`);
    if (updatedTrip && updatedTrip.length > 0) expiredTripRequests += 1;
  }

  return { expiredSnapshots: expiredSnapshots?.length ?? 0, expiredTripRequests };
}
