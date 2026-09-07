import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { scheduleLifecycleEvents } from "@/lib/whatsapp/lifecycleSchedule"
import { enqueueCreateRideGroupJob } from "@/lib/whatsapp/createRideGroup"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import { deliverAndLogWhatsAppSpec, deliverAndLogWhatsAppText } from "@/lib/whatsapp/deliverAndLogOutbound"
import { buildDriverAssignmentMessage, buildDriverContactMessage } from "@/lib/whatsapp/templateCatalog"
import { toDriverPhoneE164 } from "@/lib/drivers/phone"

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export const handleCompleteBalancePayment = async (
  supabase: SupabaseClient,
  payload: { booking_id: string; wa_message_id?: string },
): Promise<void> => {
  const bookingId = payload.booking_id
  if (!bookingId) throw new Error("complete_balance_payment requires booking_id")

  await ensureMessageTemplates(supabase)

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, payment_status, pickup_at, trip_days, tourist_id, trip_request_id, tourists(phone_e164, full_name), vendors(business_name), trip_requests(pickup_location, drop_location)",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)
  if (!booking) throw new Error(`booking ${bookingId} not found`)

  if (booking.payment_status === "fully_paid" && booking.status === "ready_for_pickup") {
    await enqueueCreateRideGroupJob(supabase, bookingId)
    return
  }

  const { data: claimed, error: updateError } = await supabase
    .from("bookings")
    .update({ payment_status: "fully_paid", status: "ready_for_pickup" })
    .eq("id", bookingId)
    .eq("payment_status", "token_paid")
    .select("id")
    .maybeSingle()

  if (updateError) throw new Error(`Failed to mark booking paid: ${updateError.message}`)
  if (!claimed?.id) {
    const { data: current } = await supabase
      .from("bookings")
      .select("payment_status, status")
      .eq("id", bookingId)
      .maybeSingle()
    if (current?.payment_status === "fully_paid" && current.status === "ready_for_pickup") {
      await enqueueCreateRideGroupJob(supabase, bookingId)
      return
    }
    throw new Error(`booking ${bookingId} could not be marked fully_paid`)
  }

  const tourist = firstOrSelf(
    booking.tourists as
      | { phone_e164: string; full_name: string | null }
      | { phone_e164: string; full_name: string | null }[]
      | null,
  )
  if (!tourist?.phone_e164) throw new Error(`booking ${bookingId} has no verified tourist phone`)

  const { data: driverDetail, error: driverDetailError } = await supabase
    .from("driver_detail_submissions")
    .select("parsed_driver_name, parsed_driver_phone, parsed_vehicle_number, parsed_vehicle_model")
    .eq("booking_id", bookingId)
    .in("parse_status", ["parsed_ok", "ops_corrected"])
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (driverDetailError) throw new Error(`Failed to fetch driver details: ${driverDetailError.message}`)
  if (!driverDetail) throw new Error(`booking ${bookingId} has no parsed driver details yet`)

  const vendorName =
    firstOrSelf(booking.vendors as { business_name: string } | { business_name: string }[] | null)?.business_name ??
    "your operator"
  const trip = firstOrSelf(
    booking.trip_requests as
      | { pickup_location: string | null; drop_location: string | null }
      | { pickup_location: string | null; drop_location: string | null }[]
      | null,
  )

  const contactMessage = buildDriverContactMessage({
    driverName: (driverDetail.parsed_driver_name as string | null) ?? "Your driver",
    driverPhone: (driverDetail.parsed_driver_phone as string | null) ?? "Contact support",
    vehicleModel: (driverDetail.parsed_vehicle_model as string | null) ?? "Vehicle",
    vehicleNumber: (driverDetail.parsed_vehicle_number as string | null) ?? "TBD",
    vendorName,
  })

  await deliverAndLogWhatsAppSpec(supabase, {
    phoneE164: tourist.phone_e164,
    spec: contactMessage,
    log: {
      tripRequestId: booking.trip_request_id as string,
      bookingId,
      touristId: booking.tourist_id as string,
    },
  })

  const driverPhoneRaw = (driverDetail.parsed_driver_phone as string | null)?.trim()
  if (driverPhoneRaw) {
    const assignmentBody = buildDriverAssignmentMessage({
      driverName: (driverDetail.parsed_driver_name as string | null) ?? "Driver",
      pickupLocation: trip?.pickup_location ?? "Pickup",
      dropLocation: trip?.drop_location ?? "Drop",
      pickupAt: booking.pickup_at as string,
      tripDays: booking.trip_days as number,
      guestPhone: tourist.phone_e164,
      guestName: tourist.full_name ?? null,
      vehicleModel: (driverDetail.parsed_vehicle_model as string | null) ?? "Vehicle",
      vehicleNumber: (driverDetail.parsed_vehicle_number as string | null) ?? "TBD",
    })
    try {
      await deliverAndLogWhatsAppText(supabase, {
        phoneE164: toDriverPhoneE164(driverPhoneRaw),
        bodyText: assignmentBody,
        templateName: "driver_assignment_v1",
        log: {
          tripRequestId: booking.trip_request_id as string,
          bookingId,
        },
      })
    } catch (error) {
      console.error("[complete_balance_payment] driver assignment send failed", error)
    }
  }

  await scheduleLifecycleEvents(supabase, bookingId, booking.pickup_at as string, booking.trip_days as number)
  await enqueueCreateRideGroupJob(supabase, bookingId)
}
