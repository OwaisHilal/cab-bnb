import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { serializeMockChatPayload } from "@/lib/demo/mockChatPayload"
import { buildDemoDriverMedia } from "@/features/demo/constants/mockChatMedia"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import {
  buildDriverAssignmentMessage,
  buildDriverBalanceMessage,
  buildDriverContactMessage,
  buildVendorNotificationDemoMessage,
} from "@/lib/whatsapp/templateCatalog"
import { deliverAndLogWhatsAppSpec, deliverAndLogWhatsAppText } from "@/lib/whatsapp/deliverAndLogOutbound"
import { TOKEN_LOCK_AMOUNT } from "@/lib/whatsapp/formatInr"

const DEMO_VENDOR_DRIVERS: Record<string, { name: string; phone: string; vehicleNumber: string }> = {
  "11111111-1111-1111-1111-111111111101": {
    name: "Bilal Ahmed",
    phone: "9876500001",
    vehicleNumber: "JK01NO1234",
  },
  "11111111-1111-1111-1111-111111111102": {
    name: "Rashid Khan",
    phone: "9876500002",
    vehicleNumber: "JK01OL5678",
  },
  "11111111-1111-1111-1111-111111111103": {
    name: "Imran Dar",
    phone: "9876500003",
    vehicleNumber: "JK01AA9012",
  },
  "11111111-1111-1111-1111-111111111104": {
    name: "Adil Mir",
    phone: "9876500004",
    vehicleNumber: "JK01UB3456",
  },
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function formatInr(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN")}`
}

export function formatDemoInr(amount: number): string {
  return formatInr(amount)
}

export function calculateDemoTripTotal(finalQuote: number, tripDays: number): number {
  return finalQuote * tripDays
}

interface BookingRow {
  id: string
  booking_ref: string
  status: string
  payment_status: string
  lock_type: string | null
  final_quote: number | null
  pickup_at: string
  trip_days: number
  pax_count: number
  vendor_id: string
  tourist_id: string
  vendors: { business_name: string; whatsapp_number: string } | { business_name: string; whatsapp_number: string }[] | null
  vehicle_types: { label: string } | { label: string }[] | null
  tourists: { full_name: string | null; phone_e164: string } | { full_name: string | null; phone_e164: string }[] | null
  trip_requests: {
    pickup_location: string | null
    drop_location: string | null
  } | { pickup_location: string | null; drop_location: string | null }[] | null
}

async function logDemoInboundFreeText(
  supabase: SupabaseClient,
  input: {
    tripRequestId: string
    bookingId?: string
    vendorId?: string
    direction: "outbound" | "inbound"
    body: string
    templateName: string
    interactionType?: "button_click" | "free_text"
    waStatus?: string
  },
): Promise<void> {
  const { error } = await supabase.from("whatsapp_message_log").insert({
    trip_request_id: input.tripRequestId,
    booking_id: input.bookingId ?? null,
    vendor_id: input.vendorId ?? null,
    direction: input.direction,
    body_snapshot: input.body,
    button_payload: serializeMockChatPayload({ templateKey: input.templateName }),
    interaction_type: input.interactionType ?? null,
    wa_message_id: `demo-inbound-${randomUUID()}`,
    wa_status: input.waStatus ?? "replied",
    template_name: input.templateName,
  })

  if (error) {
    throw new Error(`Failed to log demo inbound message: ${error.message}`)
  }
}

async function loadBookingContext(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<BookingRow | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, status, payment_status, lock_type, final_quote, pickup_at, trip_days, pax_count, vendor_id, tourist_id, vendors(business_name, whatsapp_number), vehicle_types(label), tourists(full_name, phone_e164), trip_requests(pickup_location, drop_location)",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load booking: ${error.message}`)
  return (data as unknown as BookingRow | null) ?? null
}

async function resolveVehicleModel(
  supabase: SupabaseClient,
  vendorId: string,
  vehicleTypeId: number | null,
): Promise<string> {
  if (!vehicleTypeId) return "Sedan"

  const { data } = await supabase
    .from("vendor_rate_bands")
    .select("vehicle_model")
    .eq("vendor_id", vendorId)
    .eq("vehicle_type_id", vehicleTypeId)
    .limit(1)
    .maybeSingle()

  return (data as { vehicle_model: string } | null)?.vehicle_model ?? "Sedan"
}

async function deliverDriverAssignment(
  supabase: SupabaseClient,
  input: {
    tripRequestId: string
    bookingId: string
    driverPhone: string
    body: string
  },
): Promise<void> {
  await deliverAndLogWhatsAppText(supabase, {
    phoneE164: input.driverPhone,
    bodyText: input.body,
    templateName: "driver_assignment_v1",
    templateKey: "driver_assignment_v1",
    log: {
      tripRequestId: input.tripRequestId,
      bookingId: input.bookingId,
    },
  })
}

async function attachDemoDriver(
  supabase: SupabaseClient,
  booking: BookingRow,
  tripRequestId: string,
  vehicleTypeId: number | null,
): Promise<{
  driverName: string
  driverPhone: string
  vehicleModel: string
  vehicleNumber: string
}> {
  const demoDriver = DEMO_VENDOR_DRIVERS[booking.vendor_id] ?? {
    name: "Demo Driver",
    phone: "9876500099",
    vehicleNumber: "JK01XX0000",
  }
  const vehicleModel = await resolveVehicleModel(supabase, booking.vendor_id, vehicleTypeId)
  const rawVendorReply = `DRIVER: ${demoDriver.name} | ${demoDriver.phone} | ${demoDriver.vehicleNumber} | ${vehicleModel}`

  await logDemoInboundFreeText(supabase, {
    tripRequestId,
    bookingId: booking.id,
    vendorId: booking.vendor_id,
    direction: "inbound",
    body: rawVendorReply,
    templateName: "vendor_inbound_driver_reply",
    interactionType: "free_text",
    waStatus: "replied",
  })

  const { error: insertError } = await supabase.from("driver_detail_submissions").insert({
    booking_id: booking.id,
    vendor_id: booking.vendor_id,
    raw_message_text: rawVendorReply,
    parsed_driver_name: demoDriver.name,
    parsed_driver_phone: demoDriver.phone,
    parsed_vehicle_number: demoDriver.vehicleNumber,
    parsed_vehicle_model: vehicleModel,
    parse_status: "parsed_ok",
    wa_message_id: `demo-vendor-${randomUUID()}`,
    parsed_at: new Date().toISOString(),
  })

  if (insertError) {
    throw new Error(`Failed to record demo driver details: ${insertError.message}`)
  }

  await supabase
    .from("bookings")
    .update({ status: "driver_attached" })
    .eq("id", booking.id)
    .in("status", ["vendor_confirming", "vendor_confirmed", "driver_attach_pending"])

  return {
    driverName: demoDriver.name,
    driverPhone: demoDriver.phone,
    vehicleModel,
    vehicleNumber: demoDriver.vehicleNumber,
  }
}

export async function runDemoPostTokenBookingFlow(
  supabase: SupabaseClient,
  bookingId: string,
  tripRequestId: string,
): Promise<void> {
  await ensureMessageTemplates(supabase)

  const booking = await loadBookingContext(supabase, bookingId)
  if (!booking) throw new Error("Booking not found")

  if (["driver_attached", "ready_for_pickup", "in_trip", "completed"].includes(booking.status)) {
    return
  }

  const tourist = firstOrSelf(booking.tourists)
  const vendor = firstOrSelf(booking.vendors)
  const vendorName = vendor?.business_name ?? "your operator"
  const touristPhone = tourist?.phone_e164
  if (!touristPhone) throw new Error("Booking has no tourist phone for WhatsApp delivery")

  const tripRequest = firstOrSelf(booking.trip_requests)
  const vendorBody = buildVendorNotificationDemoMessage({
    vendorName: vendor?.business_name ?? "Vendor",
    guestName: tourist?.full_name ?? null,
    guestPhone: tourist?.phone_e164 ?? "phone TBD",
    pickupLocation: tripRequest?.pickup_location ?? "Pickup",
    dropLocation: tripRequest?.drop_location ?? "Drop",
    pickupAt: booking.pickup_at,
    tripDays: booking.trip_days,
    paxCount: booking.pax_count,
    vehicleLabel: firstOrSelf(booking.vehicle_types)?.label ?? "Vehicle",
    finalQuotePerDay: booking.final_quote ?? 0,
  })
  if (vendor?.whatsapp_number) {
    await deliverAndLogWhatsAppText(supabase, {
      phoneE164: vendor.whatsapp_number,
      bodyText: vendorBody,
      templateName: "vendor_booking_notify_v1",
      log: {
        tripRequestId,
        bookingId: booking.id,
        vendorId: booking.vendor_id,
      },
    })
  } else {
    throw new Error("Winning vendor has no WhatsApp number configured")
  }

  await supabase
    .from("bookings")
    .update({ status: "vendor_confirmed" })
    .eq("id", booking.id)
    .eq("status", "vendor_confirming")

  await supabase
    .from("bookings")
    .update({ status: "driver_attach_pending" })
    .eq("id", booking.id)
    .eq("status", "vendor_confirmed")

  const { data: bookingVehicle } = await supabase
    .from("bookings")
    .select("vehicle_type_id")
    .eq("id", booking.id)
    .maybeSingle()

  const vehicleTypeId = (bookingVehicle as { vehicle_type_id: number | null } | null)?.vehicle_type_id ?? null

  const driver = await attachDemoDriver(supabase, booking, tripRequestId, vehicleTypeId)

  const totalTripCost = calculateDemoTripTotal(booking.final_quote ?? 0, booking.trip_days)
  const balanceDue = Math.max(totalTripCost - TOKEN_LOCK_AMOUNT, 0)
  const skipPaymentStep = booking.payment_status === "fully_paid"

  if (skipPaymentStep) {
    await supabase
      .from("bookings")
      .update({ status: "ready_for_pickup" })
      .eq("id", booking.id)

    const contactMessage = buildDriverContactMessage({
      driverName: driver.driverName,
      driverPhone: driver.driverPhone,
      vehicleModel: driver.vehicleModel,
      vehicleNumber: driver.vehicleNumber,
      vendorName,
    })

    await deliverAndLogWhatsAppSpec(supabase, {
      phoneE164: touristPhone,
      spec: contactMessage,
      log: {
        tripRequestId,
        bookingId: booking.id,
        touristId: booking.tourist_id,
      },
      media: buildDemoDriverMedia(driver.driverName),
    })

    await deliverDriverAssignment(supabase, {
      tripRequestId,
      bookingId: booking.id,
      driverPhone: driver.driverPhone,
      body: buildDriverAssignmentMessage({
        driverName: driver.driverName,
        pickupLocation: firstOrSelf(booking.trip_requests)?.pickup_location ?? "Pickup",
        dropLocation: firstOrSelf(booking.trip_requests)?.drop_location ?? "Drop",
        pickupAt: booking.pickup_at,
        tripDays: booking.trip_days,
        guestPhone: tourist?.phone_e164 ?? "Guest phone",
        guestName: tourist?.full_name ?? null,
        vehicleModel: driver.vehicleModel,
        vehicleNumber: driver.vehicleNumber,
      }),
    })
    return
  }

  const balanceMessage = buildDriverBalanceMessage({
    vendorName,
    balanceDue,
    bookingId: booking.id,
    driverName: driver.driverName,
    vehicleModel: driver.vehicleModel,
    vehicleNumber: driver.vehicleNumber,
  })

  await deliverAndLogWhatsAppSpec(supabase, {
    phoneE164: touristPhone,
    spec: balanceMessage,
    log: {
      tripRequestId,
      bookingId: booking.id,
      touristId: booking.tourist_id,
    },
    media: buildDemoDriverMedia(driver.driverName),
  })
}

export async function runDemoCompleteFullBookingPayment(
  supabase: SupabaseClient,
  tripRequestId: string,
  bookingId: string,
): Promise<void> {
  const booking = await loadBookingContext(supabase, bookingId)
  if (!booking) throw new Error("Booking not found")

  if (booking.lock_type !== "full_payment") {
    throw new Error("Full booking payment handler called for non-full lock")
  }

  if (booking.payment_status !== "fully_paid") {
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ payment_status: "fully_paid" })
      .eq("id", bookingId)

    if (updateError) throw new Error(`Failed to mark booking paid: ${updateError.message}`)
  }

  await runDemoPostTokenBookingFlow(supabase, bookingId, tripRequestId)
}

export async function runDemoCompleteBalancePayment(
  supabase: SupabaseClient,
  tripRequestId: string,
  bookingId: string,
): Promise<void> {
  const booking = await loadBookingContext(supabase, bookingId)
  if (!booking) throw new Error("Booking not found")

  if (booking.payment_status === "fully_paid") {
    return
  }

  const { data: driverDetail, error: driverError } = await supabase
    .from("driver_detail_submissions")
    .select("parsed_driver_name, parsed_driver_phone, parsed_vehicle_model, parsed_vehicle_number")
    .eq("booking_id", bookingId)
    .in("parse_status", ["parsed_ok", "ops_corrected"])
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (driverError) throw new Error(`Failed to load driver details: ${driverError.message}`)
  if (!driverDetail) throw new Error("Driver details not attached yet")

  const driver = driverDetail as {
    parsed_driver_name: string | null
    parsed_driver_phone: string | null
    parsed_vehicle_model: string | null
    parsed_vehicle_number: string | null
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ payment_status: "fully_paid", status: "ready_for_pickup" })
    .eq("id", bookingId)

  if (updateError) throw new Error(`Failed to mark booking paid: ${updateError.message}`)

  const vendorName = firstOrSelf(booking.vendors)?.business_name ?? "your operator"
  const tourist = firstOrSelf(booking.tourists)
  const touristPhone = tourist?.phone_e164
  if (!touristPhone) throw new Error("Booking has no tourist phone for WhatsApp delivery")

  await deliverAndLogWhatsAppSpec(supabase, {
    phoneE164: touristPhone,
    spec: buildDriverContactMessage({
      driverName: driver.parsed_driver_name ?? "Your driver",
      driverPhone: driver.parsed_driver_phone ?? "Contact support",
      vehicleModel: driver.parsed_vehicle_model ?? "Vehicle",
      vehicleNumber: driver.parsed_vehicle_number ?? "TBD",
      vendorName,
    }),
    log: {
      tripRequestId,
      bookingId,
      touristId: booking.tourist_id,
    },
    media: buildDemoDriverMedia(driver.parsed_driver_name ?? "Your driver"),
  })

  const tripRequest = firstOrSelf(booking.trip_requests)
  const driverPhone = driver.parsed_driver_phone ?? ""

  if (driverPhone) {
    await deliverDriverAssignment(supabase, {
      tripRequestId,
      bookingId,
      driverPhone,
      body: buildDriverAssignmentMessage({
        driverName: driver.parsed_driver_name ?? "Driver",
        pickupLocation: tripRequest?.pickup_location ?? "Pickup",
        dropLocation: tripRequest?.drop_location ?? "Drop",
        pickupAt: booking.pickup_at,
        tripDays: booking.trip_days,
        guestPhone: tourist?.phone_e164 ?? "Guest phone",
        guestName: tourist?.full_name ?? null,
        vehicleModel: driver.parsed_vehicle_model ?? "Vehicle",
        vehicleNumber: driver.parsed_vehicle_number ?? "TBD",
      }),
    })
  }
}
