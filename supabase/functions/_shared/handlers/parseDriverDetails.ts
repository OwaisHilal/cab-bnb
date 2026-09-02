import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enqueueJob } from "../jobQueue.ts";

// Same strict pattern as lib/whatsapp/webhook/parseInboundAction.ts (Plan
// §7.3), duplicated here rather than imported since Edge Functions can't
// import Next-side files (they run in Deno and deploy independently).
const DRIVER_DETAILS_REGEX = /^DRIVER:\s*([^|]+?)\s*\|\s*(\+?\d{10,13})\s*\|\s*([A-Z0-9\- ]+?)\s*\|\s*(.+)$/i;

const ACTIVE_VENDOR_BOOKING_STATUSES = ["vendor_confirming", "vendor_confirmed", "driver_attach_pending"];

interface ParseDriverDetailsPayload {
  raw_message_text: string;
  from_phone: string;
  wa_message_id?: string;
}

interface ResolvedBooking {
  bookingId: string;
  vendorId: string;
}

function normalizePhoneSuffix(phone: string, length = 10): string {
  return phone.replace(/\D/g, "").slice(-length);
}

/**
 * Resolves which booking a vendor's free-text reply belongs to by matching
 * the inbound WhatsApp sender number against `vendors.whatsapp_number`,
 * then picking that vendor's most recent booking still awaiting driver
 * details. Loads all vendors rather than filtering server-side because
 * `whatsapp_number` formatting isn't normalized at rest (`+91...` vs
 * `91...` vs bare 10-digit) — acceptable at current vendor counts; revisit
 * with a normalized/indexed column if vendor count grows past Plan §12's
 * ~50-vendor cache threshold.
 */
async function findActiveBookingForVendorPhone(
  supabase: SupabaseClient,
  fromPhone: string,
): Promise<ResolvedBooking | null> {
  const suffix = normalizePhoneSuffix(fromPhone);
  if (!suffix) return null;

  const { data: vendors, error: vendorsError } = await supabase
    .from("vendors")
    .select("id, whatsapp_number");

  if (vendorsError) throw new Error(`Failed to look up vendors: ${vendorsError.message}`);

  const vendor = (vendors ?? []).find(
    (row: { id: string; whatsapp_number: string }) => normalizePhoneSuffix(row.whatsapp_number) === suffix,
  ) as { id: string } | undefined;

  if (!vendor) return null;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, vendor_id")
    .eq("vendor_id", vendor.id)
    .in("status", ACTIVE_VENDOR_BOOKING_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to look up active booking for vendor: ${bookingError.message}`);
  if (!booking) return null;

  return { bookingId: booking.id as string, vendorId: booking.vendor_id as string };
}

/**
 * Checklist 3.6 / Plan §7.3: regex-parses a vendor's `DRIVER:` free-text
 * reply. On success, advances the booking and enqueues the confirmation
 * card; on failure (or if the sender/booking can't be resolved at all),
 * files an ops-review row instead of silently dropping the message.
 */
export async function handleParseDriverDetails(
  supabase: SupabaseClient,
  payload: ParseDriverDetailsPayload,
): Promise<void> {
  const { raw_message_text, from_phone, wa_message_id } = payload;

  const resolved = await findActiveBookingForVendorPhone(supabase, from_phone);

  if (!resolved) {
    await enqueueJob(supabase, "ops_alert", {
      reason: "driver_details_unresolved_vendor_or_booking",
      from_phone,
      raw_message_text,
      wa_message_id,
    });
    return;
  }

  const { bookingId, vendorId } = resolved;
  const match = raw_message_text.match(DRIVER_DETAILS_REGEX);

  if (!match) {
    const { error: insertError } = await supabase.from("driver_detail_submissions").insert({
      booking_id: bookingId,
      vendor_id: vendorId,
      raw_message_text,
      parse_status: "parse_failed",
      wa_message_id,
    });

    if (insertError) throw new Error(`Failed to record parse_failed submission: ${insertError.message}`);

    await enqueueJob(supabase, "ops_alert", {
      reason: "driver_details_parse_failed",
      booking_id: bookingId,
      vendor_id: vendorId,
      raw_message_text,
      wa_message_id,
    });
    return;
  }

  const [, name, phone, vehicleNumber, vehicleModel] = match;

  const { error: insertError } = await supabase.from("driver_detail_submissions").insert({
    booking_id: bookingId,
    vendor_id: vendorId,
    raw_message_text,
    parsed_driver_name: name.trim(),
    parsed_driver_phone: phone.trim(),
    parsed_vehicle_number: vehicleNumber.trim(),
    parsed_vehicle_model: vehicleModel.trim(),
    parse_status: "parsed_ok",
    wa_message_id,
    parsed_at: new Date().toISOString(),
  });

  if (insertError) throw new Error(`Failed to record parsed_ok submission: ${insertError.message}`);

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ status: "driver_attached" })
    .eq("id", bookingId)
    .in("status", ACTIVE_VENDOR_BOOKING_STATUSES);

  if (updateError) throw new Error(`Failed to update booking to driver_attached: ${updateError.message}`);

  const { data: bookingMeta, error: bookingMetaError } = await supabase
    .from("bookings")
    .select("lock_type")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingMetaError) throw new Error(`Failed to read booking lock_type: ${bookingMetaError.message}`);

  const lockType = (bookingMeta as { lock_type: string | null } | null)?.lock_type;

  if (lockType === "token_99") {
    await enqueueJob(supabase, "send_balance_payment", { booking_id: bookingId });
    return;
  }

  await enqueueJob(supabase, "send_confirmation_card", { booking_id: bookingId });
}
