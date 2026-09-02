import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendSmsFallback, sendWhatsAppListMessage } from "../whatsapp.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { buildQuoteMultiListMessage } from "../templateMessages.ts";

interface QuoteSnapshotRow {
  id: string;
  vendor_id: string;
  current_quote: number;
  is_best_price: boolean;
  vendors: { business_name: string } | { business_name: string }[] | null;
  vehicle_types: { label: string } | { label: string }[] | null;
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Checklist 3.2 / Plan §5 step 6, §6.1: consolidated WhatsApp quote message
 * for every `pending_send` quote_snapshot on a trip_request.
 *
 * Customer taps Pay ₹99 to Lock on the best-price quote_snapshot (WhatsApp
 * caps quick-reply buttons at 3 — we send one token button only; negotiate
 * and full-book were removed from the customer flow).
 */
export async function handleSendQuotes(
  supabase: SupabaseClient,
  payload: { trip_request_id: string },
): Promise<void> {
  const { trip_request_id } = payload;

  await ensureMessageTemplates(supabase);

  const { data: tripRequest, error: tripRequestError } = await supabase
    .from("trip_requests")
    .select("id, tourists(phone_e164)")
    .eq("id", trip_request_id)
    .maybeSingle();

  if (tripRequestError) throw new Error(`Failed to fetch trip request: ${tripRequestError.message}`);
  if (!tripRequest) throw new Error(`trip_request ${trip_request_id} not found`);

  const touristPhone = firstOrSelf(
    (tripRequest as unknown as { tourists: { phone_e164: string } | { phone_e164: string }[] | null }).tourists,
  )?.phone_e164;
  if (!touristPhone) throw new Error(`trip_request ${trip_request_id} has no verified tourist phone yet`);

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("quote_snapshots")
    .select("id, vendor_id, current_quote, is_best_price, vendors(business_name), vehicle_types(label)")
    .eq("trip_request_id", trip_request_id)
    .eq("status", "pending_send")
    .order("current_quote", { ascending: true });

  if (snapshotsError) throw new Error(`Failed to fetch quote snapshots: ${snapshotsError.message}`);
  if (!snapshots || snapshots.length === 0) return;

  const rows = snapshots as unknown as QuoteSnapshotRow[];
  const bestPrice = rows.find((row) => row.is_best_price) ?? rows[0];

  const quoteRows = rows.map((row) => ({
    quoteSnapshotId: row.id,
    vendorName: firstOrSelf(row.vendors)?.business_name ?? "Vendor",
    pricePerDay: row.current_quote,
    vehicleLabel: firstOrSelf(row.vehicle_types)?.label ?? "Vehicle",
  }));

  const listMessage = buildQuoteMultiListMessage({ quoteRows });
  const bodyText = listMessage.bodyText;
  const listPayload = listMessage.list;
  const buttonPayloadLog = JSON.stringify({
    templateKey: quoteRows.length > 1 ? "quote_multi_v1" : "quote_single_v1",
    list: listPayload,
  });

  let sendResult = await sendWhatsAppListMessage(touristPhone, bodyText, listPayload);
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
    template_name: quoteRows.length > 1 ? "quote_multi_v1" : "quote_single_v1",
  });

  if (logError) throw new Error(`Failed to log outbound WhatsApp message: ${logError.message}`);

  const { error: updateTripError } = await supabase
    .from("trip_requests")
    .update({ status: "quotes_sent" })
    .eq("id", trip_request_id);

  if (updateTripError) throw new Error(`Failed to update trip request status: ${updateTripError.message}`);
}
