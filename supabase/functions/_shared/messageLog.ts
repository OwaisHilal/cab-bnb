import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface OutboundMessageLogFields {
  bookingId?: string;
  vendorId?: string;
  touristId?: string;
  tripRequestId?: string;
  quoteSnapshotId?: string;
  bodySnapshot: string;
  waMessageId?: string;
  waStatus: "accepted" | "sent" | "delivered" | "read" | "failed" | "replied";
}

/**
 * Shared `whatsapp_message_log` outbound insert (Plan §11: "log every
 * outbound/inbound WhatsApp interaction"). `sendQuotes.ts` and
 * `computeNegotiation.ts` inline this insert themselves for the
 * trip_request/quote_snapshot columns they already had in scope; Phase
 * 3's post-booking handlers (3.5-3.9) log against `booking_id`/`vendor_id`/
 * `tourist_id` instead, so this covers all of the log's nullable foreign
 * keys rather than duplicating the insert in every new handler.
 */
export async function logOutboundWhatsAppMessage(
  supabase: SupabaseClient,
  fields: OutboundMessageLogFields,
): Promise<void> {
  const { error } = await supabase.from("whatsapp_message_log").insert({
    booking_id: fields.bookingId ?? null,
    vendor_id: fields.vendorId ?? null,
    tourist_id: fields.touristId ?? null,
    trip_request_id: fields.tripRequestId ?? null,
    quote_snapshot_id: fields.quoteSnapshotId ?? null,
    direction: "outbound",
    body_snapshot: fields.bodySnapshot,
    wa_message_id: fields.waMessageId ?? null,
    wa_status: fields.waStatus,
  });

  if (error) {
    throw new Error(`Failed to log outbound WhatsApp message: ${error.message}`);
  }
}
