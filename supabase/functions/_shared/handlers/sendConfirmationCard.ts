import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsAppImageMessage, sendWhatsAppTextMessage } from "../whatsapp.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";

const MIDTRIP_WELLNESS_MIN_DAYS_DEFAULT = 3;

interface BookingRow {
  id: string;
  status: string;
  pickup_at: string;
  trip_days: number;
  tourist_id: string;
  tourists: { phone_e164: string } | { phone_e164: string }[] | null;
  vendors: { business_name: string } | { business_name: string }[] | null;
  trip_requests: { pickup_location: string | null } | { pickup_location: string | null }[] | null;
  vehicle_types: { code: string } | { code: string }[] | null;
}

interface DriverDetailRow {
  parsed_driver_name: string | null;
  parsed_vehicle_number: string | null;
  parsed_vehicle_model: string | null;
}

function formatPickupDateTime(pickupAt: string): string {
  return new Date(pickupAt).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildConfirmationMessage(booking: BookingRow, driver: DriverDetailRow): string {
  const vendorName = firstOrSelf(booking.vendors)?.business_name ?? "your vendor";
  const pickupLocation = firstOrSelf(booking.trip_requests)?.pickup_location ?? "your pickup point";

  return [
    "Your Cab Is Confirmed \u2705",
    `Driver: ${driver.parsed_driver_name ?? "TBD"}`,
    `Vehicle: ${driver.parsed_vehicle_model ?? "TBD"} (${driver.parsed_vehicle_number ?? "TBD"})`,
    `Pickup: ${formatPickupDateTime(booking.pickup_at)} \u2014 ${pickupLocation}`,
    `Vendor: ${vendorName}`,
  ].join("\n");
}

/**
 * Schedules the Plan §6.5 lifecycle touchpoints for a booking. Guarded by
 * an existence check so a retried `send_confirmation_card` job (e.g. the
 * confirmation send succeeds but the process crashes before the booking
 * status update) doesn't double-schedule reminders.
 */
async function scheduleLifecycleEvents(
  supabase: SupabaseClient,
  bookingId: string,
  pickupAt: string,
  tripDays: number,
): Promise<void> {
  const { count, error: countError } = await supabase
    .from("booking_lifecycle_events")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", bookingId);

  if (countError) throw new Error(`Failed to check existing lifecycle events: ${countError.message}`);
  if ((count ?? 0) > 0) return;

  const pickupMs = new Date(pickupAt).getTime();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const midtripMinDays = Number(Deno.env.get("MIDTRIP_WELLNESS_MIN_DAYS")) || MIDTRIP_WELLNESS_MIN_DAYS_DEFAULT;

  const events: Array<{ booking_id: string; event_type: string; scheduled_at: string }> = [
    {
      booking_id: bookingId,
      event_type: "pre_pickup_reminder",
      scheduled_at: new Date(pickupMs - 12 * hour).toISOString(),
    },
    {
      booking_id: bookingId,
      event_type: "day1_checkin",
      scheduled_at: new Date(pickupMs + 2 * hour).toISOString(),
    },
    {
      booking_id: bookingId,
      event_type: "post_trip_review",
      scheduled_at: new Date(pickupMs + tripDays * day + day).toISOString(),
    },
  ];

  if (tripDays >= midtripMinDays) {
    events.push({
      booking_id: bookingId,
      event_type: "midtrip_wellness",
      scheduled_at: new Date(pickupMs + 1.5 * day).toISOString(),
    });
  }

  const { error: insertError } = await supabase.from("booking_lifecycle_events").insert(events);
  if (insertError) throw new Error(`Failed to schedule lifecycle events: ${insertError.message}`);
}

/**
 * Resolves the optional confirmation-card image URL from env, preferring a
 * per-vehicle override over the generic fallback (Plan §6.4 final pass):
 * `CONFIRMATION_CARD_IMAGE_URL_<VEHICLE_CODE_UPPER>` (e.g. `_SEDAN`) then
 * `CONFIRMATION_CARD_IMAGE_URL`. Returns null when neither is configured,
 * which callers treat as "stay text-only".
 */
function resolveConfirmationCardImageUrl(vehicleCode: string | null): string | null {
  if (vehicleCode) {
    const perVehicleUrl = Deno.env.get(`CONFIRMATION_CARD_IMAGE_URL_${vehicleCode.toUpperCase()}`);
    if (perVehicleUrl) return perVehicleUrl;
  }

  return Deno.env.get("CONFIRMATION_CARD_IMAGE_URL") ?? null;
}

/**
 * Checklist 3.7 / Plan §6.4: sends the customer confirmation card once
 * driver details are attached, then schedules the post-booking lifecycle
 * touchpoints (Plan §6.5) and advances the booking to `ready_for_pickup`.
 *
 * Sends an image+caption message when a `CONFIRMATION_CARD_IMAGE_URL*` env
 * var resolves to a URL for this booking's vehicle type, otherwise falls
 * back to the original text-only message — no media storage/upload step
 * is needed since the Cloud API accepts a public image link directly.
 */
export async function handleSendConfirmationCard(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const { booking_id } = payload;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, pickup_at, trip_days, tourist_id, tourists(phone_e164), vendors(business_name), trip_requests(pickup_location), vehicle_types(code)",
    )
    .eq("id", booking_id)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking) throw new Error(`booking ${booking_id} not found`);

  const row = booking as unknown as BookingRow;

  if (row.status === "ready_for_pickup") return; // already confirmed; idempotent no-op

  const touristPhone = firstOrSelf(row.tourists)?.phone_e164;
  if (!touristPhone) throw new Error(`booking ${booking_id} has no verified tourist phone`);

  const { data: driverDetail, error: driverDetailError } = await supabase
    .from("driver_detail_submissions")
    .select("parsed_driver_name, parsed_vehicle_number, parsed_vehicle_model")
    .eq("booking_id", booking_id)
    .in("parse_status", ["parsed_ok", "ops_corrected"])
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (driverDetailError) throw new Error(`Failed to fetch driver details: ${driverDetailError.message}`);
  if (!driverDetail) throw new Error(`booking ${booking_id} has no parsed driver details yet`);

  const bodyText = buildConfirmationMessage(row, driverDetail as DriverDetailRow);
  const vehicleCode = firstOrSelf(row.vehicle_types)?.code ?? null;
  const imageUrl = resolveConfirmationCardImageUrl(vehicleCode);

  const sendResult = imageUrl
    ? await sendWhatsAppImageMessage(touristPhone, imageUrl, bodyText)
    : await sendWhatsAppTextMessage(touristPhone, bodyText);

  if (!sendResult.success) {
    throw new Error(`Failed to send confirmation card: ${sendResult.error}`);
  }

  await logOutboundWhatsAppMessage(supabase, {
    bookingId: booking_id,
    touristId: row.tourist_id,
    bodySnapshot: bodyText,
    waMessageId: sendResult.waMessageId,
    waStatus: "sent",
  });

  await scheduleLifecycleEvents(supabase, booking_id, row.pickup_at, row.trip_days);

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ status: "ready_for_pickup" })
    .eq("id", booking_id)
    .neq("status", "ready_for_pickup");

  if (updateError) throw new Error(`Failed to update booking to ready_for_pickup: ${updateError.message}`);
}
