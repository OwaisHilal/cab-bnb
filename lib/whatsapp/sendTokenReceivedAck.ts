import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import { deliverAndLogWhatsAppSpec } from "@/lib/whatsapp/deliverAndLogOutbound"
import { TOKEN_RECEIVED_TEMPLATE_KEY, buildTokenReceivedAckMessage } from "@/lib/whatsapp/tokenReceivedAck"

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export const handleSendTokenReceivedAck = async (
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> => {
  const bookingId = payload.booking_id
  if (!bookingId) throw new Error("send_token_received_ack requires booking_id")

  await ensureMessageTemplates(supabase)

  const { data: existingLog, error: logLookupError } = await supabase
    .from("whatsapp_message_log")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("direction", "outbound")
    .eq("template_name", TOKEN_RECEIVED_TEMPLATE_KEY)
    .limit(1)
    .maybeSingle()

  if (logLookupError) {
    throw new Error(`Failed to check token ack log: ${logLookupError.message}`)
  }
  if (existingLog?.id) return

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, trip_request_id, tourist_id, vendor_id, trip_days, pax_count, lock_type, tourists(phone_e164), vendors(business_name), vehicle_types(label), trip_requests(pickup_location, drop_location)",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)
  if (!booking) throw new Error(`booking ${bookingId} not found`)
  if (booking.lock_type !== "token_99") return

  const touristPhone = firstOrSelf(booking.tourists as { phone_e164: string } | { phone_e164: string }[] | null)
    ?.phone_e164
  if (!touristPhone) throw new Error(`booking ${bookingId} has no tourist phone`)

  const trip = firstOrSelf(
    booking.trip_requests as
      | { pickup_location: string | null; drop_location: string | null }
      | { pickup_location: string | null; drop_location: string | null }[]
      | null,
  )
  const spec = buildTokenReceivedAckMessage({
    tripDays: booking.trip_days as number,
    paxCount: booking.pax_count as number,
    vehicleLabel: firstOrSelf(booking.vehicle_types as { label: string } | { label: string }[] | null)?.label ?? "Cab",
    pickupLocation: trip?.pickup_location,
    dropLocation: trip?.drop_location,
    vendorName: firstOrSelf(booking.vendors as { business_name: string } | { business_name: string }[] | null)
      ?.business_name ?? "your operator",
  })

  await deliverAndLogWhatsAppSpec(supabase, {
    phoneE164: touristPhone,
    spec,
    templateName: TOKEN_RECEIVED_TEMPLATE_KEY,
    log: {
      tripRequestId: booking.trip_request_id as string,
      bookingId,
      touristId: booking.tourist_id as string,
      vendorId: booking.vendor_id as string,
    },
  })
}
