import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { scheduleLifecycleEvents } from "../lifecycleSchedule.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { buildDriverAssignmentMessage, buildDriverContactMessage } from "../templateMessages.ts";
import { sendWhatsAppTextMessage } from "../whatsapp.ts";

interface BookingRow {
  id: string;
  status: string;
  payment_status: string;
  pickup_at: string;
  trip_days: number;
  tourist_id: string;
  tourists: { phone_e164: string; full_name: string | null } | { phone_e164: string; full_name: string | null }[] | null;
  vendors: { business_name: string } | { business_name: string }[] | null;
  trip_requests:
    | { pickup_location: string | null; drop_location: string | null }
    | { pickup_location: string | null; drop_location: string | null }[]
    | null;
}

interface DriverDetailRow {
  parsed_driver_name: string | null;
  parsed_driver_phone: string | null;
  parsed_vehicle_number: string | null;
  parsed_vehicle_model: string | null;
}

function normalizeDriverPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.trim().startsWith("+")) return phone.trim();
  return `+${digits}`;
}

/**
 * Tourist tapped COMPLETE_PAYMENT — mark booking paid, send driver contact to
 * guest, notify assigned driver, schedule lifecycle reminders.
 */
export async function handleCompleteBalancePayment(
  supabase: SupabaseClient,
  payload: { booking_id: string; wa_message_id?: string },
): Promise<void> {
  const { booking_id } = payload;

  await ensureMessageTemplates(supabase);

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, payment_status, pickup_at, trip_days, tourist_id, tourists(phone_e164, full_name), vendors(business_name), trip_requests(pickup_location, drop_location)",
    )
    .eq("id", booking_id)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking) throw new Error(`booking ${booking_id} not found`);

  const row = booking as unknown as BookingRow;

  if (row.payment_status === "fully_paid" && row.status === "ready_for_pickup") {
    return;
  }

  const touristPhone = firstOrSelf(row.tourists)?.phone_e164;
  if (!touristPhone) throw new Error(`booking ${booking_id} has no verified tourist phone`);

  const { data: driverDetail, error: driverDetailError } = await supabase
    .from("driver_detail_submissions")
    .select("parsed_driver_name, parsed_driver_phone, parsed_vehicle_number, parsed_vehicle_model")
    .eq("booking_id", booking_id)
    .in("parse_status", ["parsed_ok", "ops_corrected"])
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (driverDetailError) throw new Error(`Failed to fetch driver details: ${driverDetailError.message}`);
  if (!driverDetail) throw new Error(`booking ${booking_id} has no parsed driver details yet`);

  const driver = driverDetail as DriverDetailRow;
  const vendorName = firstOrSelf(row.vendors)?.business_name ?? "your operator";
  const tripRequest = firstOrSelf(row.trip_requests);
  const tourist = firstOrSelf(row.tourists);

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ payment_status: "fully_paid", status: "ready_for_pickup" })
    .eq("id", booking_id);

  if (updateError) throw new Error(`Failed to mark booking paid: ${updateError.message}`);

  const contactBody = buildDriverContactMessage({
    driverName: driver.parsed_driver_name ?? "Your driver",
    driverPhone: driver.parsed_driver_phone ?? "Contact support",
    vehicleModel: driver.parsed_vehicle_model ?? "Vehicle",
    vehicleNumber: driver.parsed_vehicle_number ?? "TBD",
    vendorName,
  });

  const contactSend = await sendWhatsAppTextMessage(touristPhone, contactBody);
  if (!contactSend.success) {
    throw new Error(`Failed to send driver contact to tourist: ${contactSend.error}`);
  }

  await logOutboundWhatsAppMessage(supabase, {
    bookingId: booking_id,
    touristId: row.tourist_id,
    bodySnapshot: contactBody,
    waMessageId: contactSend.waMessageId,
    waStatus: "sent",
    templateName: "driver_contact_v1",
  });

  const driverPhoneRaw = driver.parsed_driver_phone?.trim();
  if (driverPhoneRaw) {
    const driverPhoneE164 = normalizeDriverPhoneE164(driverPhoneRaw);
    const assignmentBody = buildDriverAssignmentMessage({
      driverName: driver.parsed_driver_name ?? "Driver",
      pickupLocation: tripRequest?.pickup_location ?? "Pickup",
      dropLocation: tripRequest?.drop_location ?? "Drop",
      pickupAt: row.pickup_at,
      tripDays: row.trip_days,
      guestPhone: touristPhone,
      guestName: tourist?.full_name ?? null,
      vehicleModel: driver.parsed_vehicle_model ?? "Vehicle",
      vehicleNumber: driver.parsed_vehicle_number ?? "TBD",
    });

    const driverSend = await sendWhatsAppTextMessage(driverPhoneE164, assignmentBody);
    if (driverSend.success) {
      await logOutboundWhatsAppMessage(supabase, {
        bookingId: booking_id,
        bodySnapshot: assignmentBody,
        waMessageId: driverSend.waMessageId,
        waStatus: "sent",
        templateName: "driver_assignment_v1",
      });
    }
  }

  await scheduleLifecycleEvents(supabase, booking_id, row.pickup_at, row.trip_days);
}
