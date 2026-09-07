import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import {
  DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY,
  buildBalancePaymentLinkCopy,
  calculateBalanceDue,
} from "../templateMessages.ts";
import { sendWhatsAppPaymentLinkMessageWithHeaderRetry } from "../whatsapp.ts";
import { enqueueJob } from "../jobQueue.ts";
import { stripE164Plus } from "../msg91WhatsApp.ts";

interface BookingRow {
  id: string;
  status: string;
  payment_status: string;
  lock_type: string | null;
  final_quote: number | null;
  trip_days: number;
  pax_count: number;
  tourist_id: string;
  vendor_id: string;
  trip_request_id: string | null;
  winning_quote_snapshot_id: string | null;
  tourists: { phone_e164: string } | { phone_e164: string }[] | null;
  vendors: { business_name: string; reliability_score: number | null } | { business_name: string; reliability_score: number | null }[] | null;
  vehicle_types: { label: string; code: string } | { label: string; code: string }[] | null;
  trip_requests:
    | { pickup_location: string | null; drop_location: string | null; trip_start_date: string }
    | { pickup_location: string | null; drop_location: string | null; trip_start_date: string }[]
    | null;
  drivers: { full_name: string; photo_url: string | null } | { full_name: string; photo_url: string | null }[] | null;
  vehicles:
    | { stock_photo_url: string | null; registration_number: string | null; model: string | null }
    | { stock_photo_url: string | null; registration_number: string | null; model: string | null }[]
    | null;
}

async function fetchDriverCardUrl(bookingId: string): Promise<string | undefined> {
  const appUrl = Deno.env.get("APP_URL")?.replace(/\/$/, "");
  const secret = Deno.env.get("CRON_SECRET");
  if (!appUrl || !secret) return undefined;
  try {
    const response = await fetch(`${appUrl}/api/internal/driver-card`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ booking_id: bookingId }),
    });
    if (!response.ok) return undefined;
    const json = (await response.json()) as { url?: string | null };
    return json.url || undefined;
  } catch {
    return undefined;
  }
}

export async function handleSendBalancePayment(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const { booking_id } = payload;
  await ensureMessageTemplates(supabase);

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, payment_status, lock_type, final_quote, trip_days, pax_count, tourist_id, vendor_id, trip_request_id, winning_quote_snapshot_id, tourists(phone_e164), vendors(business_name, reliability_score), vehicle_types(label, code), trip_requests(pickup_location, drop_location, trip_start_date), drivers(full_name, photo_url), vehicles(stock_photo_url, registration_number, model)",
    )
    .eq("id", booking_id)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking) throw new Error(`booking ${booking_id} not found`);

  const row = booking as unknown as BookingRow;
  if (row.lock_type !== "token_99") return;
  if (row.payment_status === "fully_paid") return;

  const { data: existingLog } = await supabase
    .from("whatsapp_message_log")
    .select("id")
    .eq("booking_id", booking_id)
    .eq("direction", "outbound")
    .eq("template_name", DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY)
    .limit(1)
    .maybeSingle();
  if (existingLog?.id) return;

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

  if (driverDetailError) throw new Error(`Failed to verify driver details: ${driverDetailError.message}`);
  if (!driverDetail) throw new Error(`booking ${booking_id} has no parsed driver details yet`);

  const balanceDue = calculateBalanceDue(row.final_quote ?? 0, row.trip_days);
  if (balanceDue <= 0) {
    await enqueueJob(supabase, "complete_balance_payment", { booking_id });
    return;
  }

  const { crqid, intentReady, alreadySent } = await upsertBalanceIntent(supabase, {
    bookingId: booking_id,
    quoteSnapshotId: row.winning_quote_snapshot_id,
    tripRequestId: row.trip_request_id,
    touristId: row.tourist_id,
    vendorId: row.vendor_id,
    customerNumber: stripE164Plus(touristPhone),
    amountInr: balanceDue,
  });
  if (alreadySent) return;

  const vendor = firstOrSelf(row.vendors);
  const trip = firstOrSelf(row.trip_requests);
  const vehicleType = firstOrSelf(row.vehicle_types);
  const linkedDriver = firstOrSelf(row.drivers);
  const linkedVehicle = firstOrSelf(row.vehicles);
  const driverName = (driverDetail.parsed_driver_name as string | null) ?? linkedDriver?.full_name ?? "Your driver";
  const vehicleModel = (driverDetail.parsed_vehicle_model as string | null) ?? linkedVehicle?.model ?? "Vehicle";
  const vehicleNumber =
    (driverDetail.parsed_vehicle_number as string | null) ?? linkedVehicle?.registration_number ?? "TBD";

  const copy = buildBalancePaymentLinkCopy({
    tripDays: row.trip_days,
    paxCount: row.pax_count,
    vehicleLabel: vehicleType?.label ?? "Cab",
    pickupLocation: trip?.pickup_location,
    dropLocation: trip?.drop_location,
    vendorName: vendor?.business_name ?? "your operator",
    pricePerDay: row.final_quote ?? 0,
    rating: vendor?.reliability_score ?? null,
    driverName,
    vehicleModel,
    vehicleNumber,
    balanceDue,
  });

  const headerImageUrl = await fetchDriverCardUrl(booking_id);

  const sendResult = await sendWhatsAppPaymentLinkMessageWithHeaderRetry({
    toE164: touristPhone,
    bodyText: copy.bodyText,
    footerText: copy.footerText,
    headerImageUrl,
    items: [{ name: copy.itemName, amount: copy.amountInr, quantity: copy.quantity }],
    crqid,
  });

  if (!sendResult.success) {
    if (intentReady) {
      await supabase
        .from("whatsapp_payment_intents")
        .update({ last_error: sendResult.error ?? "payment_link_send_failed" })
        .eq("id", crqid)
        .in("status", ["pending", "sent"]);
    }
    throw new Error(`Failed to send balance payment request: ${sendResult.error}`);
  }

  if (intentReady) {
    await supabase
      .from("whatsapp_payment_intents")
      .update({ status: "sent", wa_message_id: sendResult.waMessageId ?? null, last_error: null })
      .eq("id", crqid)
      .neq("status", "paid");
  }

  await logOutboundWhatsAppMessage(supabase, {
    bookingId: booking_id,
    touristId: row.tourist_id,
    tripRequestId: row.trip_request_id ?? undefined,
    quoteSnapshotId: row.winning_quote_snapshot_id ?? undefined,
    bodySnapshot: copy.bodyText,
    buttonPayload: JSON.stringify({
      templateKey: DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY,
      sendMethod: "session_payment_link",
      crqid,
      amountInr: balanceDue,
    }),
    waMessageId: sendResult.waMessageId,
    waStatus: "sent",
    templateName: DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY,
  });
}

const DUPLICATE_KEY_ERROR_CODE = "23505";

function isMissingRelation(error: { code?: string; message: string }): boolean {
  const code = error.code ?? "";
  const message = error.message.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("whatsapp_payment_intents") &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")))
  );
}

async function upsertBalanceIntent(
  supabase: SupabaseClient,
  input: {
    bookingId: string;
    quoteSnapshotId: string | null;
    tripRequestId: string | null;
    touristId: string;
    vendorId: string;
    customerNumber: string;
    amountInr: number;
  },
): Promise<{ crqid: string; intentReady: boolean; alreadySent: boolean }> {
  if (!input.quoteSnapshotId) {
    return { crqid: input.bookingId, intentReady: false, alreadySent: false };
  }

  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_payment_intents")
    .select("id, status")
    .eq("booking_id", input.bookingId)
    .eq("purpose", "balance")
    .in("status", ["pending", "sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    if (isMissingRelation(existingError) || existingError.message.toLowerCase().includes("purpose")) {
      return { crqid: input.bookingId, intentReady: false, alreadySent: false };
    }
    throw new Error(`Failed to load balance intent: ${existingError.message}`);
  }

  if (existing?.id) {
    return {
      crqid: existing.id as string,
      intentReady: true,
      alreadySent: existing.status === "sent",
    };
  }

  const intentId = randomUUID();
  const { error: insertError } = await supabase.from("whatsapp_payment_intents").insert({
    id: intentId,
    quote_snapshot_id: input.quoteSnapshotId,
    trip_request_id: input.tripRequestId,
    tourist_id: input.touristId,
    vendor_id: input.vendorId,
    booking_id: input.bookingId,
    customer_number: input.customerNumber,
    amount_inr: input.amountInr,
    purpose: "balance",
    status: "pending",
    crqid: intentId,
  });

  if (insertError) {
    if (isMissingRelation(insertError) || insertError.message.toLowerCase().includes("purpose")) {
      return { crqid: input.bookingId, intentReady: false, alreadySent: false };
    }
    if (insertError.code === DUPLICATE_KEY_ERROR_CODE) {
      const { data: raced } = await supabase
        .from("whatsapp_payment_intents")
        .select("id, status")
        .eq("booking_id", input.bookingId)
        .eq("purpose", "balance")
        .in("status", ["pending", "sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (raced?.id) {
        return {
          crqid: raced.id as string,
          intentReady: true,
          alreadySent: raced.status === "sent",
        };
      }
    }
    throw new Error(`Failed to create balance intent: ${insertError.message}`);
  }

  return { crqid: intentId, intentReady: true, alreadySent: false };
}

