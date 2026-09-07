import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { formatInr } from "@/lib/whatsapp/formatInr"
import { ensureMessageTemplates, getMessageTemplate, renderMessageTemplate } from "@/lib/whatsapp/messageTemplateStore"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/templateKeys"
import { deliverAndLogWhatsAppSpec } from "@/lib/whatsapp/deliverAndLogOutbound"
import type { WhatsAppMessageSpec } from "@/lib/whatsapp/types"

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

const formatPickupDate = (pickupAt: string): string => {
  return new Date(pickupAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

export const buildVendorAssignDriverMessage = (input: {
  guestName: string
  pickupLocation: string
  dropLocation: string
  pickupAt: string
  tripDays: number
  paxCount: number
  vehicleLabel: string
  tripTotal: number
}): WhatsAppMessageSpec => {
  const pickupDate = formatPickupDate(input.pickupAt)
  const dayLabel = input.tripDays > 1 ? "days" : "day"
  const tripTotal = formatInr(input.tripTotal)
  const template = getMessageTemplate(WHATSAPP_TEMPLATE_KEYS.VENDOR_ASSIGN_DRIVER)
  const bodyText = renderMessageTemplate(
    template?.body_template ??
      "New booking confirmed.\n\nGuest: {{guest_name}}\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nPax: {{pax_count}} | Cab: {{vehicle_label}}\nTotal: {{trip_total}}\n\nReply with the driver's 10-digit mobile to assign.\nOptional: DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>",
    {
      guest_name: input.guestName,
      pickup: input.pickupLocation,
      drop: input.dropLocation,
      pickup_date: pickupDate,
      trip_days: String(input.tripDays),
      day_label: dayLabel,
      pax_count: String(input.paxCount),
      vehicle_label: input.vehicleLabel,
      trip_total: tripTotal,
    },
  )

  return {
    templateKey: WHATSAPP_TEMPLATE_KEYS.VENDOR_ASSIGN_DRIVER,
    bodyText,
    buttons: [],
    msg91Components: {
      body_1: { type: "text", value: input.guestName },
      body_2: { type: "text", value: input.pickupLocation },
      body_3: { type: "text", value: input.dropLocation },
      body_4: { type: "text", value: pickupDate },
      body_5: { type: "text", value: String(input.tripDays) },
      body_6: { type: "text", value: dayLabel },
      body_7: { type: "text", value: String(input.paxCount) },
      body_8: { type: "text", value: input.vehicleLabel },
      body_9: { type: "text", value: tripTotal },
    },
    msg91SendMode: "template",
  }
}

export const handleNotifyVendorBooking = async (
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> => {
  const bookingId = payload.booking_id
  if (!bookingId) throw new Error("notify_vendor_booking requires booking_id")

  await ensureMessageTemplates(supabase)

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, final_quote, pickup_at, trip_days, pax_count, vendor_id, trip_request_id, vendors(business_name, whatsapp_number), vehicle_types(label), trip_requests(pickup_location, drop_location), tourists(full_name)",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)
  if (!booking) throw new Error(`booking ${bookingId} not found`)
  if (booking.status !== "vendor_confirming") return

  const vendor = firstOrSelf(
    booking.vendors as
      | { business_name: string; whatsapp_number: string }
      | { business_name: string; whatsapp_number: string }[]
      | null,
  )
  if (!vendor?.whatsapp_number) throw new Error(`booking ${bookingId} has no vendor WhatsApp number`)

  const trip = firstOrSelf(
    booking.trip_requests as
      | { pickup_location: string | null; drop_location: string | null }
      | { pickup_location: string | null; drop_location: string | null }[]
      | null,
  )
  const guestName =
    firstOrSelf(booking.tourists as { full_name: string | null } | { full_name: string | null }[] | null)?.full_name?.trim() ||
    "Guest"
  const tripDays = booking.trip_days as number
  const spec = buildVendorAssignDriverMessage({
    guestName,
    pickupLocation: trip?.pickup_location ?? "Pickup",
    dropLocation: trip?.drop_location ?? "Drop",
    pickupAt: booking.pickup_at as string,
    tripDays,
    paxCount: booking.pax_count as number,
    vehicleLabel: firstOrSelf(booking.vehicle_types as { label: string } | { label: string }[] | null)?.label ?? "Vehicle",
    tripTotal: Number(booking.final_quote ?? 0) * tripDays,
  })

  await deliverAndLogWhatsAppSpec(supabase, {
    phoneE164: vendor.whatsapp_number,
    spec,
    templateName: WHATSAPP_TEMPLATE_KEYS.VENDOR_ASSIGN_DRIVER,
    log: {
      tripRequestId: booking.trip_request_id as string,
      bookingId,
      vendorId: booking.vendor_id as string,
    },
  })

  await supabase
    .from("bookings")
    .update({ status: "vendor_confirmed" })
    .eq("id", bookingId)
    .eq("status", "vendor_confirming")

  const { error: advanceError } = await supabase
    .from("bookings")
    .update({ status: "driver_attach_pending" })
    .eq("id", bookingId)
    .eq("status", "vendor_confirmed")

  if (advanceError) throw new Error(`Failed to advance booking to driver_attach_pending: ${advanceError.message}`)
}
