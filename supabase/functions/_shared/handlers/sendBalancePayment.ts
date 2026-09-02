import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logOutboundWhatsAppMessage } from "../messageLog.ts";
import { firstOrSelf } from "../relations.ts";
import { ensureMessageTemplates } from "../messageTemplateStore.ts";
import { buildDriverBalanceMessage, calculateBalanceDue } from "../templateMessages.ts";
import { sendWhatsAppButtonMessage } from "../whatsapp.ts";

interface BookingRow {
  id: string;
  status: string;
  payment_status: string;
  lock_type: string | null;
  final_quote: number | null;
  trip_days: number;
  tourist_id: string;
  tourists: { phone_e164: string } | { phone_e164: string }[] | null;
  vendors: { business_name: string } | { business_name: string }[] | null;
}

/**
 * After Nova/vendor replies with driver details, ask the tourist for balance
 * payment before releasing driver contact (token_99 flow).
 */
export async function handleSendBalancePayment(
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> {
  const { booking_id } = payload;

  await ensureMessageTemplates(supabase);

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, payment_status, lock_type, final_quote, trip_days, tourist_id, tourists(phone_e164), vendors(business_name)",
    )
    .eq("id", booking_id)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking) throw new Error(`booking ${booking_id} not found`);

  const row = booking as unknown as BookingRow;

  if (row.lock_type !== "token_99") {
    return;
  }

  if (row.payment_status === "fully_paid") {
    return;
  }

  const touristPhone = firstOrSelf(row.tourists)?.phone_e164;
  if (!touristPhone) throw new Error(`booking ${booking_id} has no verified tourist phone`);

  const { count, error: driverCountError } = await supabase
    .from("driver_detail_submissions")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking_id)
    .in("parse_status", ["parsed_ok", "ops_corrected"]);

  if (driverCountError) throw new Error(`Failed to verify driver details: ${driverCountError.message}`);
  if ((driverCount ?? 0) === 0) {
    throw new Error(`booking ${booking_id} has no parsed driver details yet`);
  }

  const vendorName = firstOrSelf(row.vendors)?.business_name ?? "your operator";
  const balanceDue = calculateBalanceDue(row.final_quote ?? 0, row.trip_days);
  const message = buildDriverBalanceMessage({ vendorName, balanceDue, bookingId: booking_id });

  const sendResult = await sendWhatsAppButtonMessage(touristPhone, message.bodyText, message.buttons);
  if (!sendResult.success) {
    throw new Error(`Failed to send balance payment request: ${sendResult.error}`);
  }

  await logOutboundWhatsAppMessage(supabase, {
    bookingId: booking_id,
    touristId: row.tourist_id,
    bodySnapshot: message.bodyText,
    buttonPayload: JSON.stringify({ templateKey: "driver_balance_v1", buttons: message.buttons }),
    waMessageId: sendResult.waMessageId,
    waStatus: "sent",
    templateName: "driver_balance_v1",
  });
}
