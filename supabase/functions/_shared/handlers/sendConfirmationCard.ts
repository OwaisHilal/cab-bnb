import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { scheduleLifecycleEvents } from "../lifecycleSchedule.ts";
import { sendWhatsAppImageMessage, sendWhatsAppTextMessage } from "../whatsapp.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { buildConfirmationMessage as renderConfirmationMessage } from "../templateMessages.ts";

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

  await ensureMessageTemplates(supabase);

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

  const driver = driverDetail as DriverDetailRow;
  const vendorName = firstOrSelf(row.vendors)?.business_name ?? "your vendor";
  const pickupLocation = firstOrSelf(row.trip_requests)?.pickup_location ?? "your pickup point";
  const bodyText = renderConfirmationMessage({
    driverName: driver.parsed_driver_name ?? "TBD",
    vehicleModel: driver.parsed_vehicle_model ?? "TBD",
    vehicleNumber: driver.parsed_vehicle_number ?? "TBD",
    pickupTime: formatPickupDateTime(row.pickup_at),
    pickupLocation,
    vendorName,
  });
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
