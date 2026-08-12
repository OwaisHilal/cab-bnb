import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsAppButtonMessage } from "../whatsapp.ts";

interface ComputeNegotiationRow {
  next_quote: number;
  is_final: boolean;
  negotiation_round: number;
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Checklist 3.3 / Plan §3.4, §6.2, §7.2: runs the locked negotiation
 * decrement (existing `compute_negotiation` Postgres function, migration
 * 0009 — unchanged) then sends the customer the resulting counter-offer.
 */
export async function handleComputeNegotiation(
  supabase: SupabaseClient,
  payload: { quote_snapshot_id: string },
): Promise<void> {
  const { quote_snapshot_id } = payload;

  const { data, error } = await supabase
    .rpc("compute_negotiation", { p_quote_snapshot_id: quote_snapshot_id })
    .single<ComputeNegotiationRow>();

  if (error) throw new Error(`compute_negotiation failed: ${error.message}`);
  if (!data) throw new Error("compute_negotiation returned no result");

  const { data: snapshot, error: snapshotError } = await supabase
    .from("quote_snapshots")
    .select("id, trip_request_id, vendors(business_name), trip_requests(tourists(phone_e164))")
    .eq("id", quote_snapshot_id)
    .maybeSingle();

  if (snapshotError) throw new Error(`Failed to fetch quote snapshot: ${snapshotError.message}`);
  if (!snapshot) throw new Error(`quote_snapshot ${quote_snapshot_id} not found`);

  const tripRequest = firstOrSelf(
    (snapshot as unknown as { trip_requests: { tourists: unknown } | { tourists: unknown }[] | null }).trip_requests,
  );
  const touristPhone = firstOrSelf(
    tripRequest?.tourists as { phone_e164: string } | { phone_e164: string }[] | null,
  )?.phone_e164;

  if (!touristPhone) throw new Error(`quote_snapshot ${quote_snapshot_id} has no verified tourist phone`);

  const bodyText = data.is_final
    ? `This is our best possible price: \u20b9${data.next_quote}/day. Final offer.`
    : `Here's our next offer: \u20b9${data.next_quote}/day.`;

  const buttons = data.is_final
    ? [
        { id: `BOOK_FULL::${quote_snapshot_id}`, title: "Book Now" },
        { id: `BOOK_TOKEN::${quote_snapshot_id}`, title: "Pay \u20b999 to Lock" },
      ]
    : [
        { id: `BOOK_FULL::${quote_snapshot_id}`, title: "Book This Price" },
        { id: `NEGOTIATE::${quote_snapshot_id}`, title: "Negotiate Again" },
        { id: `BOOK_TOKEN::${quote_snapshot_id}`, title: "Pay \u20b999 to Lock" },
      ];

  const sendResult = await sendWhatsAppButtonMessage(touristPhone, bodyText, buttons);
  if (!sendResult.success) {
    throw new Error(`Failed to send negotiation response: ${sendResult.error}`);
  }

  const { error: logError } = await supabase.from("whatsapp_message_log").insert({
    trip_request_id: (snapshot as unknown as { trip_request_id: string }).trip_request_id,
    quote_snapshot_id,
    direction: "outbound",
    body_snapshot: bodyText,
    wa_message_id: sendResult.waMessageId ?? null,
    wa_status: "sent",
  });

  if (logError) throw new Error(`Failed to log outbound WhatsApp message: ${logError.message}`);
}
