import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendMsg91TemplateMessage } from "../msg91WhatsApp.ts";
import { sendWhatsAppTextMessage } from "../whatsapp.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { TOKEN_RECEIVED_TEMPLATE_KEY, buildTokenReceivedAckMessage } from "../templateMessages.ts";

export async function handleSendTokenReceivedAck(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const { booking_id } = payload;
  await ensureMessageTemplates(supabase);

  const { data: existingLog } = await supabase
    .from("whatsapp_message_log")
    .select("id")
    .eq("booking_id", booking_id)
    .eq("direction", "outbound")
    .eq("template_name", TOKEN_RECEIVED_TEMPLATE_KEY)
    .limit(1)
    .maybeSingle();
  if (existingLog?.id) return;

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, trip_request_id, tourist_id, vendor_id, trip_days, pax_count, lock_type, tourists(phone_e164), vendors(business_name), vehicle_types(label), trip_requests(pickup_location, drop_location)",
    )
    .eq("id", booking_id)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch booking: ${error.message}`);
  if (!booking) throw new Error(`booking ${booking_id} not found`);
  if ((booking as { lock_type: string | null }).lock_type !== "token_99") return;

  const touristPhone = firstOrSelf(
    (booking as { tourists: { phone_e164: string } | { phone_e164: string }[] | null }).tourists,
  )?.phone_e164;
  if (!touristPhone) throw new Error(`booking ${booking_id} has no tourist phone`);

  const trip = firstOrSelf(
    (booking as {
      trip_requests:
        | { pickup_location: string | null; drop_location: string | null }
        | { pickup_location: string | null; drop_location: string | null }[]
        | null;
    }).trip_requests,
  );
  const message = buildTokenReceivedAckMessage({
    tripDays: booking.trip_days as number,
    paxCount: booking.pax_count as number,
    vehicleLabel: firstOrSelf((booking as { vehicle_types: { label: string } | { label: string }[] | null }).vehicle_types)
      ?.label ?? "Cab",
    pickupLocation: trip?.pickup_location,
    dropLocation: trip?.drop_location,
    vendorName: firstOrSelf(
      (booking as { vendors: { business_name: string } | { business_name: string }[] | null }).vendors,
    )?.business_name ?? "your operator",
  });

  const templateName = Deno.env.get("MSG91_TOKEN_RECEIVED_TEMPLATE_NAME")?.trim() || TOKEN_RECEIVED_TEMPLATE_KEY;
  const namespace = Deno.env.get("MSG91_TOKEN_RECEIVED_TEMPLATE_NAMESPACE")?.trim();
  let sendResult = await sendMsg91TemplateMessage({
    toE164: touristPhone,
    templateName,
    languageCode: Deno.env.get("MSG91_OTP_TEMPLATE_LANGUAGE")?.trim() || "en_US",
    namespace: namespace || undefined,
    components: message.msg91Components,
  });
  if (!sendResult.success) {
    sendResult = await sendWhatsAppTextMessage(touristPhone, message.bodyText);
  }
  if (!sendResult.success) {
    throw new Error(`Failed to send token received ack: ${sendResult.error}`);
  }

  await logOutboundWhatsAppMessage(supabase, {
    bookingId: booking_id,
    tripRequestId: booking.trip_request_id as string,
    touristId: booking.tourist_id as string,
    vendorId: booking.vendor_id as string,
    bodySnapshot: message.bodyText,
    waMessageId: sendResult.waMessageId,
    waStatus: "sent",
    templateName: TOKEN_RECEIVED_TEMPLATE_KEY,
  });
}
