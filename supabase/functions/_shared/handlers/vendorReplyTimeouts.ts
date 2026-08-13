import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enqueueJob } from "../jobQueue.ts";

const VENDOR_DRIVER_DETAIL_SLA_MINUTES_DEFAULT = 30;
const ACTIVE_VENDOR_BOOKING_STATUSES = ["vendor_confirming", "vendor_confirmed", "driver_attach_pending"];
const RESOLVED_DRIVER_DETAIL_STATUSES = ["parsed_ok", "ops_corrected"];

interface TimedOutBookingRow {
  id: string;
  vendor_id: string;
  trip_request_id: string | null;
  status: string;
  created_at: string;
  vendors: { business_name: string } | { business_name: string }[] | null;
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Plan §9: `vendor_reply_timeout_job` — escalates bookings still waiting on
 * a vendor's `DRIVER:` reply past the SLA window to ops, rather than
 * leaving the customer waiting indefinitely with no visibility. Cron-
 * triggered every 10 minutes (Checklist Phase 3 final pass), not consumed
 * from `job_queue` — mirrors `dispatch-lifecycle-events`/`expire-stale-quotes`.
 *
 * Excludes bookings that already have a resolved (`parsed_ok`/
 * `ops_corrected`) driver_detail_submissions row — those have already
 * advanced past `ACTIVE_VENDOR_BOOKING_STATUSES` via
 * `handleParseDriverDetails`/`app/api/admin/driver-details/[id]/correct`,
 * so this is a defensive filter rather than the primary guard.
 */
export async function handleVendorReplyTimeouts(
  supabase: SupabaseClient,
): Promise<{ escalated: number }> {
  const slaMinutes =
    Number(Deno.env.get("VENDOR_DRIVER_DETAIL_SLA_MINUTES")) || VENDOR_DRIVER_DETAIL_SLA_MINUTES_DEFAULT;
  const cutoff = new Date(Date.now() - slaMinutes * 60_000).toISOString();

  const { data: candidates, error: candidatesError } = await supabase
    .from("bookings")
    .select("id, vendor_id, trip_request_id, status, created_at, vendors(business_name)")
    .in("status", ACTIVE_VENDOR_BOOKING_STATUSES)
    .lte("created_at", cutoff);

  if (candidatesError) throw new Error(`Failed to query timed-out bookings: ${candidatesError.message}`);

  const rows = (candidates ?? []) as unknown as TimedOutBookingRow[];
  if (rows.length === 0) return { escalated: 0 };

  const bookingIds = rows.map((row) => row.id);

  const { data: resolvedSubmissions, error: submissionsError } = await supabase
    .from("driver_detail_submissions")
    .select("booking_id")
    .in("booking_id", bookingIds)
    .in("parse_status", RESOLVED_DRIVER_DETAIL_STATUSES);

  if (submissionsError) {
    throw new Error(`Failed to check resolved driver detail submissions: ${submissionsError.message}`);
  }

  const resolvedBookingIds = new Set(
    (resolvedSubmissions ?? []).map((row) => (row as { booking_id: string }).booking_id),
  );

  let escalated = 0;

  for (const booking of rows) {
    if (resolvedBookingIds.has(booking.id)) continue;

    const { error: updateError } = await supabase
      .from("bookings")
      .update({ status: "no_response_exception" })
      .eq("id", booking.id)
      .in("status", ACTIVE_VENDOR_BOOKING_STATUSES);

    if (updateError) {
      throw new Error(`Failed to mark booking ${booking.id} as no_response_exception: ${updateError.message}`);
    }

    const vendorName = firstOrSelf(booking.vendors)?.business_name ?? "Vendor";

    await enqueueJob(supabase, "ops_alert", {
      reason: "vendor_driver_detail_sla_exceeded",
      booking_id: booking.id,
      vendor_id: booking.vendor_id,
      vendor_name: vendorName,
      trip_request_id: booking.trip_request_id,
      previous_status: booking.status,
      sla_minutes: slaMinutes,
      booking_created_at: booking.created_at,
    });

    escalated += 1;
  }

  return { escalated };
}
