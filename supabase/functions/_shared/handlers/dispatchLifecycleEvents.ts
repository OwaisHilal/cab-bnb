import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsAppButtonMessage, sendWhatsAppTextMessage, type WhatsAppButton } from "../whatsapp.ts";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";

const BATCH_SIZE = 50;

interface BookingJoin {
  id: string;
  tourist_id: string;
  tourists: { phone_e164: string } | { phone_e164: string }[] | null;
}

interface LifecycleEventRow {
  id: string;
  booking_id: string;
  event_type: string;
  bookings: BookingJoin | BookingJoin[] | null;
}

interface DriverDetailRow {
  parsed_driver_name: string | null;
  parsed_vehicle_model: string | null;
  parsed_vehicle_number: string | null;
}

async function fetchLatestParsedDriverDetail(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<DriverDetailRow | null> {
  const { data, error } = await supabase
    .from("driver_detail_submissions")
    .select("parsed_driver_name, parsed_vehicle_model, parsed_vehicle_number")
    .eq("booking_id", bookingId)
    .in("parse_status", ["parsed_ok", "ops_corrected"])
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch driver details for lifecycle event: ${error.message}`);
  return (data as DriverDetailRow | null) ?? null;
}

interface EventMessage {
  bodyText: string;
  buttons?: WhatsAppButton[];
}

async function buildMessageForEvent(supabase: SupabaseClient, event: LifecycleEventRow): Promise<EventMessage> {
  switch (event.event_type) {
    case "pre_pickup_reminder": {
      const driver = await fetchLatestParsedDriverDetail(supabase, event.booking_id);
      const driverLine = driver?.parsed_driver_name
        ? `Driver: ${driver.parsed_driver_name}, Vehicle: ${driver.parsed_vehicle_model ?? "TBD"} (${driver.parsed_vehicle_number ?? "TBD"})`
        : "Driver details are being finalized.";
      return {
        bodyText: [
          "Reminder: your Kashmir cab pickup is tomorrow \ud83d\ude97",
          driverLine,
          "Need help? Reply to this message and our support team will assist.",
        ].join("\n"),
      };
    }
    case "day1_checkin":
      return {
        bodyText: "How was your pickup this morning?",
        buttons: [
          { id: `CHECKIN_OK::${event.id}`, title: "All Good" },
          { id: `CHECKIN_HELP::${event.id}`, title: "Report Issue" },
        ],
      };
    case "midtrip_wellness":
      return {
        bodyText: "Everything going smoothly on your trip so far?",
        buttons: [
          { id: `CHECKIN_OK::${event.id}`, title: "Yes, all good" },
          { id: `CHECKIN_HELP::${event.id}`, title: "Need Help" },
        ],
      };
    case "post_trip_review":
      // WhatsApp caps quick-reply buttons at 3 (Plan §6.1 footnote), so this
      // offers 3 quick ratings rather than the full 1-5 scale. Buttons key
      // off `booking_id` (not this event's id) because
      // lib/whatsapp/webhook/parseInboundAction.ts's RATE_N handler already
      // treats the button's entity id as a `bookingId`.
      return {
        bodyText: "How was your trip? Tap a rating below.",
        buttons: [
          { id: `RATE_5::${event.booking_id}`, title: "Excellent" },
          { id: `RATE_3::${event.booking_id}`, title: "Okay" },
          { id: `RATE_1::${event.booking_id}`, title: "Poor" },
        ],
      };
    default:
      throw new Error(`Unhandled lifecycle event_type "${event.event_type}"`);
  }
}

async function dispatchSingleEvent(supabase: SupabaseClient, event: LifecycleEventRow): Promise<void> {
  const booking = firstOrSelf(event.bookings);
  if (!booking) throw new Error(`lifecycle event ${event.id} has no linked booking`);

  const touristPhone = firstOrSelf(booking.tourists)?.phone_e164;
  if (!touristPhone) throw new Error(`lifecycle event ${event.id} has no verified tourist phone`);

  const { bodyText, buttons } = await buildMessageForEvent(supabase, event);

  const sendResult = buttons
    ? await sendWhatsAppButtonMessage(touristPhone, bodyText, buttons)
    : await sendWhatsAppTextMessage(touristPhone, bodyText);

  if (!sendResult.success) {
    throw new Error(`Failed to send lifecycle event message: ${sendResult.error}`);
  }

  await logOutboundWhatsAppMessage(supabase, {
    bookingId: event.booking_id,
    touristId: booking.tourist_id,
    bodySnapshot: bodyText,
    waMessageId: sendResult.waMessageId,
    waStatus: "sent",
  });

  const { error: updateError } = await supabase
    .from("booking_lifecycle_events")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", event.id)
    .eq("status", "scheduled");

  if (updateError) throw new Error(`Failed to mark lifecycle event sent: ${updateError.message}`);
}

/**
 * Checklist 3.8 / Plan §6.5: sends any due `booking_lifecycle_events` row
 * (`status = 'scheduled'` and `scheduled_at <= now()`), attaching quick
 * reply buttons for `CHECKIN_OK`/`CHECKIN_HELP`/`RATE_1..RATE_5` where
 * applicable. Failures are isolated per-event (marked `failed`, logged, and
 * skipped) so one bad row doesn't block the rest of the batch.
 */
export async function handleDispatchLifecycleEvents(
  supabase: SupabaseClient,
): Promise<{ sent: number; failed: number }> {
  const nowIso = new Date().toISOString();

  const { data: events, error: eventsError } = await supabase
    .from("booking_lifecycle_events")
    .select("id, booking_id, event_type, bookings(id, tourist_id, tourists(phone_e164))")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .limit(BATCH_SIZE);

  if (eventsError) throw new Error(`Failed to fetch due lifecycle events: ${eventsError.message}`);

  let sent = 0;
  let failed = 0;

  for (const event of (events ?? []) as unknown as LifecycleEventRow[]) {
    try {
      await dispatchSingleEvent(supabase, event);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`[dispatch-lifecycle-events] event ${event.id} failed`, error);
      await supabase
        .from("booking_lifecycle_events")
        .update({ status: "failed" })
        .eq("id", event.id)
        .eq("status", "scheduled");
    }
  }

  return { sent, failed };
}
