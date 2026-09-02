import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsAppTextMessage } from "../whatsapp.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { buildVendorNotificationMessage } from "../templateMessages.ts";

interface BookingRow {
  id: string;
  status: string;
  final_quote: number | null;
  pickup_at: string;
  trip_days: number;
  pax_count: number;
  vendor_id: string;
  vendors: { business_name: string; whatsapp_number: string } | { business_name: string; whatsapp_number: string }[] | null;
  vehicle_types: { label: string } | { label: string }[] | null;
  trip_requests: { pickup_location: string | null; drop_location: string | null } | { pickup_location: string | null; drop_location: string | null }[] | null;
}

/**
 * Checklist 3.5 / Plan §6.3: notifies the winning vendor over WhatsApp
 * asking for driver+vehicle details, strictly post-booking-commit (Plan
 * §1 invariant — this handler only ever runs for a `notify_vendor_booking`
 * job, which `finalize_quote_booking` (migration 0009) only enqueues after
 * the booking row already exists).
 */
export async function handleNotifyVendorBooking(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const { booking_id } = payload;

  await ensureMessageTemplates(supabase);

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, final_quote, pickup_at, trip_days, pax_count, vendor_id, vendors(business_name, whatsapp_number), vehicle_types(label), trip_requests(pickup_location, drop_location)",
    )
    .eq("id", booking_id)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking) throw new Error(`booking ${booking_id} not found`);

  const row = booking as unknown as BookingRow;

  // Idempotent no-op on retry: once this handler has advanced the booking
  // past `vendor_confirming`, a retried job (e.g. after a crash between the
  // send and the status update below) should not re-ping the vendor.
  if (row.status !== "vendor_confirming") return;

  const vendor = firstOrSelf(row.vendors);
  if (!vendor?.whatsapp_number) throw new Error(`booking ${booking_id} has no vendor WhatsApp number`);

  const tripRequest = firstOrSelf(row.trip_requests);
  const bodyText = buildVendorNotificationMessage({
    pickupLocation: tripRequest?.pickup_location ?? "Pickup",
    dropLocation: tripRequest?.drop_location ?? "Drop",
    pickupAt: row.pickup_at,
    tripDays: row.trip_days,
    paxCount: row.pax_count,
    vehicleLabel: firstOrSelf(row.vehicle_types)?.label ?? "Vehicle",
    finalQuotePerDay: row.final_quote ?? 0,
  });

  const sendResult = await sendWhatsAppTextMessage(vendor.whatsapp_number, bodyText);

  if (!sendResult.success) {
    throw new Error(`Failed to notify vendor: ${sendResult.error}`);
  }

  await logOutboundWhatsAppMessage(supabase, {
    bookingId: booking_id,
    vendorId: row.vendor_id,
    bodySnapshot: bodyText,
    waMessageId: sendResult.waMessageId,
    waStatus: "sent",
  });

  // Checklist 3.5 literally specifies both transitions; each update is
  // guarded by its expected prior status so a retried job that already
  // advanced the booking (but crashed before this point) is a safe no-op
  // rather than double-writing.
  await supabase
    .from("bookings")
    .update({ status: "vendor_confirmed" })
    .eq("id", booking_id)
    .eq("status", "vendor_confirming");

  const { error: advanceError } = await supabase
    .from("bookings")
    .update({ status: "driver_attach_pending" })
    .eq("id", booking_id)
    .eq("status", "vendor_confirmed");

  if (advanceError) throw new Error(`Failed to advance booking to driver_attach_pending: ${advanceError.message}`);
}
