import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendSmsFallback, sendWhatsAppButtonMessage, sendWhatsAppListMessage } from "../whatsapp.ts";
import { sendMsg91TemplateMessage } from "../msg91WhatsApp.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { buildQuoteChoiceMessage, buildQuoteMultiListMessage } from "../templateMessages.ts";

interface QuoteSnapshotRow {
  id: string;
  vendor_id: string;
  current_quote: number;
  is_best_price: boolean;
  vendors:
    | { business_name: string; reliability_score: number | null }
    | { business_name: string; reliability_score: number | null }[]
    | null;
  vehicle_types: { label: string } | { label: string }[] | null;
}

interface TripRequestRow {
  id: string;
  pickup_location: string | null;
  drop_location: string | null;
  trip_days: number;
  pax_count: number;
  tourists: { phone_e164: string } | { phone_e164: string }[] | null;
  requested_vehicle_type: { label: string } | { label: string }[] | null;
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Checklist 3.2 / Plan §5 step 6, §6.1: first-contact WhatsApp quote message
 * after the tourist submits a phone number.
 *
 * 2+ quotes use `quote_choice_v1` with Select {vendorName} buttons.
 */
export async function handleSendQuotes(
  supabase: SupabaseClient,
  payload: { trip_request_id: string },
): Promise<void> {
  const { trip_request_id } = payload;

  await ensureMessageTemplates(supabase);

  const { data: tripRequest, error: tripRequestError } = await supabase
    .from("trip_requests")
    .select(
      "id, pickup_location, drop_location, trip_days, pax_count, tourists(phone_e164), requested_vehicle_type:vehicle_types!requested_vehicle_type_id(label)",
    )
    .eq("id", trip_request_id)
    .maybeSingle();

  if (tripRequestError) throw new Error(`Failed to fetch trip request: ${tripRequestError.message}`);
  if (!tripRequest) throw new Error(`trip_request ${trip_request_id} not found`);

  const trip = tripRequest as unknown as TripRequestRow;
  const touristPhone = firstOrSelf(trip.tourists)?.phone_e164;
  if (!touristPhone) throw new Error(`trip_request ${trip_request_id} has no verified tourist phone yet`);

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("quote_snapshots")
    .select("id, vendor_id, current_quote, is_best_price, vendors(business_name, reliability_score), vehicle_types(label)")
    .eq("trip_request_id", trip_request_id)
    .eq("status", "pending_send")
    .order("current_quote", { ascending: true });

  if (snapshotsError) throw new Error(`Failed to fetch quote snapshots: ${snapshotsError.message}`);
  if (!snapshots || snapshots.length === 0) return;

  const rows = snapshots as unknown as QuoteSnapshotRow[];
  const bestPrice = rows.find((row) => row.is_best_price) ?? rows[0];
  const vehicleLabel =
    firstOrSelf(trip.requested_vehicle_type)?.label ??
    firstOrSelf(rows[0].vehicle_types)?.label ??
    "Cab";

  let bodyText: string;
  let buttonPayloadLog: string;
  let templateName: string;
  let sendResult;

  if (rows.length === 1) {
    const quoteRows = rows.map((row) => ({
      quoteSnapshotId: row.id,
      vendorName: firstOrSelf(row.vendors)?.business_name ?? "Vendor",
      pricePerDay: row.current_quote,
      vehicleLabel: firstOrSelf(row.vehicle_types)?.label ?? vehicleLabel,
    }));
    const listMessage = buildQuoteMultiListMessage({ quoteRows });
    bodyText = listMessage.bodyText;
    templateName = "quote_single_v1";
    buttonPayloadLog = JSON.stringify({
      templateKey: templateName,
      list: listMessage.list,
    });
    sendResult = await sendWhatsAppListMessage(touristPhone, bodyText, listMessage.list);
  } else {
    const quotes = rows.slice(0, 3).map((row) => {
      const vendor = firstOrSelf(row.vendors);
      return {
        quoteSnapshotId: row.id,
        vendorName: vendor?.business_name ?? "Vendor",
        pricePerDay: row.current_quote,
        rating: vendor?.reliability_score ?? null,
      };
    });
    const choice = buildQuoteChoiceMessage({
      trip: {
        tripDays: trip.trip_days,
        paxCount: trip.pax_count,
        vehicleLabel,
        pickupLocation: trip.pickup_location,
        dropLocation: trip.drop_location,
      },
      quotes,
    });
    bodyText = choice.bodyText;
    templateName = choice.templateKey;
    buttonPayloadLog = JSON.stringify({
      templateKey: templateName,
      buttons: choice.buttons,
      msg91Components: choice.msg91Components,
    });

    const templateNameEnv = Deno.env.get("MSG91_QUOTE_CHOICE_TEMPLATE_NAME")?.trim() || "quote_choice_v2";
    const namespace = Deno.env.get("MSG91_QUOTE_CHOICE_TEMPLATE_NAMESPACE")?.trim();
    const languageCode = Deno.env.get("MSG91_OTP_TEMPLATE_LANGUAGE")?.trim() || "en_US";

    sendResult = await sendMsg91TemplateMessage({
      toE164: touristPhone,
      templateName: templateNameEnv,
      languageCode,
      namespace: namespace || undefined,
      components: choice.msg91Components,
    });

    if (!sendResult.success) {
      sendResult = await sendWhatsAppButtonMessage(touristPhone, choice.bodyText, choice.buttons, {
        footerText: choice.footerText,
      });
    }
  }

  let sentChannel: "whatsapp" | "sms" = "whatsapp";

  if (!sendResult.success) {
    const smsResult = await sendSmsFallback();
    if (!smsResult.success) {
      throw new Error(`Quote delivery failed on all channels: ${sendResult.error ?? smsResult.error}`);
    }
    sendResult = smsResult;
    sentChannel = "sms";
  }

  const snapshotIds = rows.map((row) => row.id);

  const { error: updateSnapshotsError } = await supabase
    .from("quote_snapshots")
    .update({ status: "sent", sent_channel: sentChannel, wa_message_id: sendResult.waMessageId ?? null })
    .in("id", snapshotIds);

  if (updateSnapshotsError) throw new Error(`Failed to update quote snapshots: ${updateSnapshotsError.message}`);

  const { error: logError } = await supabase.from("whatsapp_message_log").insert({
    trip_request_id,
    quote_snapshot_id: bestPrice.id,
    direction: "outbound",
    body_snapshot: bodyText,
    button_payload: buttonPayloadLog,
    wa_message_id: sendResult.waMessageId ?? null,
    wa_status: sentChannel === "whatsapp" ? "sent" : "accepted",
    template_name: templateName,
  });

  if (logError) throw new Error(`Failed to log outbound WhatsApp message: ${logError.message}`);

  const { error: updateTripError } = await supabase
    .from("trip_requests")
    .update({ status: "quotes_sent" })
    .eq("id", trip_request_id);

  if (updateTripError) throw new Error(`Failed to update trip request status: ${updateTripError.message}`);
}
