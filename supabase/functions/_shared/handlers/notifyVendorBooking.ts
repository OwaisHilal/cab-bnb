import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendMsg91TemplateMessage } from "../msg91WhatsApp.ts";
import { shouldUseMsg91ApprovedTemplates } from "../useApprovedTemplates.ts";
import { sendWhatsAppTextMessage } from "../whatsapp.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { VENDOR_ASSIGN_DRIVER_TEMPLATE_KEY, buildVendorAssignDriverMessage } from "../templateMessages.ts";

interface BookingRow {
  id: string;
  status: string;
  final_quote: number | null;
  pickup_at: string;
  trip_days: number;
  pax_count: number;
  vendor_id: string;
  trip_request_id: string | null;
  vendors: { business_name: string; whatsapp_number: string } | { business_name: string; whatsapp_number: string }[] | null;
  vehicle_types: { label: string } | { label: string }[] | null;
  trip_requests: { pickup_location: string | null; drop_location: string | null } | { pickup_location: string | null; drop_location: string | null }[] | null;
  tourists: { full_name: string | null } | { full_name: string | null }[] | null;
}

export async function handleNotifyVendorBooking(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const { booking_id } = payload;
  await ensureMessageTemplates(supabase);

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, final_quote, pickup_at, trip_days, pax_count, vendor_id, trip_request_id, vendors(business_name, whatsapp_number), vehicle_types(label), trip_requests(pickup_location, drop_location), tourists(full_name)",
    )
    .eq("id", booking_id)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking) throw new Error(`booking ${booking_id} not found`);

  const row = booking as unknown as BookingRow;
  if (row.status !== "vendor_confirming") return;

  const vendor = firstOrSelf(row.vendors);
  if (!vendor?.whatsapp_number) throw new Error(`booking ${booking_id} has no vendor WhatsApp number`);

  const tripRequest = firstOrSelf(row.trip_requests);
  const guestName = firstOrSelf(row.tourists)?.full_name?.trim() || "Guest";
  const message = buildVendorAssignDriverMessage({
    guestName,
    pickupLocation: tripRequest?.pickup_location ?? "Pickup",
    dropLocation: tripRequest?.drop_location ?? "Drop",
    pickupAt: row.pickup_at,
    tripDays: row.trip_days,
    paxCount: row.pax_count,
    vehicleLabel: firstOrSelf(row.vehicle_types)?.label ?? "Vehicle",
    tripTotal: (row.final_quote ?? 0) * row.trip_days,
  });

  // Live assign-driver Utility. Do not read MSG91_VENDOR_BOOKING_NOTIFY_* here.
  const templateName = Deno.env.get("MSG91_VENDOR_NOTIFY_TEMPLATE_NAME")?.trim() || VENDOR_ASSIGN_DRIVER_TEMPLATE_KEY;
  const namespace = Deno.env.get("MSG91_VENDOR_NOTIFY_TEMPLATE_NAMESPACE")?.trim();
  let sendResult = shouldUseMsg91ApprovedTemplates()
    ? await sendMsg91TemplateMessage({
        toE164: vendor.whatsapp_number,
        templateName,
        languageCode: Deno.env.get("MSG91_OTP_TEMPLATE_LANGUAGE")?.trim() || "en_US",
        namespace: namespace || undefined,
        components: message.msg91Components,
      })
    : { configured: true, success: false };
  if (!sendResult.success) {
    sendResult = await sendWhatsAppTextMessage(vendor.whatsapp_number, message.bodyText);
  }
  if (!sendResult.success) {
    throw new Error(`Failed to notify vendor: ${sendResult.error}`);
  }

  await logOutboundWhatsAppMessage(supabase, {
    bookingId: booking_id,
    vendorId: row.vendor_id,
    tripRequestId: row.trip_request_id ?? undefined,
    bodySnapshot: message.bodyText,
    waMessageId: sendResult.waMessageId,
    waStatus: "sent",
    templateName: VENDOR_ASSIGN_DRIVER_TEMPLATE_KEY,
  });

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
