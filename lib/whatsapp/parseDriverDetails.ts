import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { phoneLast10, toDriverPhoneE164 } from "@/lib/drivers/phone"
import { shouldOpsAlertUnresolvedSender } from "@/lib/whatsapp/paymentReport"
import {
  ACTIVE_VENDOR_BOOKING_STATUSES,
  ATTACHED_OR_LATER_BOOKING_STATUSES,
  vendorWhatsAppLookupValues,
} from "@/lib/drivers/vendorPhone"

const DRIVER_DETAILS_REGEX =
  /^DRIVER:\s*([^|]+?)\s*\|\s*(\+?\d{10,13})\s*\|\s*([A-Z0-9\- ]+?)\s*\|\s*([^|]+?)(?:\s*\|\s*(.+))?$/i
const DRIVER_DETAILS_PREFIX_REGEX = /^DRIVER:/i

export interface ParseDriverDetailsPayload {
  raw_message_text: string
  from_phone: string
  wa_message_id?: string
}

interface ResolvedBooking {
  bookingId: string
  vendorId: string
  status: string
  lockType: string | null
  paymentStatus: string
  vehicleTypeId: number | null
}

const enqueueJob = async (
  supabase: SupabaseClient,
  jobType: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const { error } = await supabase.from("job_queue").insert({ job_type: jobType, payload })
  if (error) throw new Error(`Failed to enqueue ${jobType} job: ${error.message}`)
}

const findVendorIdByWhatsApp = async (
  supabase: SupabaseClient,
  fromPhone: string,
): Promise<string | null> => {
  const suffix = phoneLast10(fromPhone)
  if (!suffix) return null
  const lookupValues = vendorWhatsAppLookupValues(suffix)
  const { data: exact, error: exactError } = await supabase
    .from("vendors")
    .select("id, whatsapp_number")
    .in("whatsapp_number", lookupValues)
    .limit(5)
  if (exactError) throw new Error(`Failed to look up vendors: ${exactError.message}`)
  const exactMatch = (exact ?? []).find(
    (row: { id: string; whatsapp_number: string }) => phoneLast10(row.whatsapp_number) === suffix,
  )
  if (exactMatch) return exactMatch.id as string

  const { data: fuzzy, error: fuzzyError } = await supabase
    .from("vendors")
    .select("id, whatsapp_number")
    .ilike("whatsapp_number", `%${suffix}`)
    .limit(5)
  if (fuzzyError) throw new Error(`Failed to look up vendors: ${fuzzyError.message}`)
  const fuzzyMatch = (fuzzy ?? []).find(
    (row: { id: string; whatsapp_number: string }) => phoneLast10(row.whatsapp_number) === suffix,
  )
  return (fuzzyMatch?.id as string | undefined) ?? null
}

const mapBookingRow = (booking: {
  id: string
  vendor_id: string
  status: string
  lock_type: string | null
  payment_status: string
  vehicle_type_id: number | null
}): ResolvedBooking => ({
  bookingId: booking.id,
  vendorId: booking.vendor_id,
  status: booking.status,
  lockType: booking.lock_type,
  paymentStatus: booking.payment_status,
  vehicleTypeId: booking.vehicle_type_id,
})

const findActiveBookingForVendorPhone = async (
  supabase: SupabaseClient,
  fromPhone: string,
): Promise<ResolvedBooking | null> => {
  const vendorId = await findVendorIdByWhatsApp(supabase, fromPhone)
  if (!vendorId) return null

  const selectCols = "id, vendor_id, status, lock_type, payment_status, vehicle_type_id"
  const { data: waiting, error: waitingError } = await supabase
    .from("bookings")
    .select(selectCols)
    .eq("vendor_id", vendorId)
    .in("status", [...ACTIVE_VENDOR_BOOKING_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (waitingError) throw new Error(`Failed to look up active booking for vendor: ${waitingError.message}`)
  if (waiting) return mapBookingRow(waiting)

  const { data: attached, error: attachedError } = await supabase
    .from("bookings")
    .select(selectCols)
    .eq("vendor_id", vendorId)
    .in("status", [...ATTACHED_OR_LATER_BOOKING_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (attachedError) throw new Error(`Failed to look up active booking for vendor: ${attachedError.message}`)
  if (!attached) return null
  return mapBookingRow(attached)
}

const upsertDriverAndVehicle = async (
  supabase: SupabaseClient,
  input: {
    vendorId: string
    name: string
    phone: string
    vehicleNumber: string
    vehicleModel: string
    vehicleTypeId: number | null
  },
): Promise<{ driverId: string; vehicleId: string }> => {
  const phoneE164 = toDriverPhoneE164(input.phone)
  const last10 = phoneLast10(phoneE164)

  const { data: existingDriver, error: driverLookupError } = await supabase
    .from("drivers")
    .select("id")
    .eq("vendor_id", input.vendorId)
    .eq("phone_last10", last10)
    .maybeSingle()

  if (driverLookupError && !isMissingFleet(driverLookupError)) {
    throw new Error(`Failed to look up driver: ${driverLookupError.message}`)
  }

  let driverId = existingDriver?.id as string | undefined
  if (!driverId) {
    const { data: inserted, error: insertDriverError } = await supabase
      .from("drivers")
      .insert({
        vendor_id: input.vendorId,
        full_name: input.name,
        phone_e164: phoneE164,
        status: "active",
      })
      .select("id")
      .maybeSingle()
    if (insertDriverError) {
      if (isMissingFleet(insertDriverError)) {
        return { driverId: "", vehicleId: "" }
      }
      throw new Error(`Failed to insert driver: ${insertDriverError.message}`)
    }
    driverId = inserted?.id as string
  } else {
    await supabase.from("drivers").update({ full_name: input.name, status: "active" }).eq("id", driverId)
  }

  const { data: existingVehicle, error: vehicleLookupError } = await supabase
    .from("vehicles")
    .select("id")
    .eq("vendor_id", input.vendorId)
    .eq("registration_number", input.vehicleNumber)
    .maybeSingle()

  if (vehicleLookupError && !isMissingFleet(vehicleLookupError)) {
    throw new Error(`Failed to look up vehicle: ${vehicleLookupError.message}`)
  }

  let vehicleId = existingVehicle?.id as string | undefined
  if (!vehicleId) {
    const { data: insertedVehicle, error: insertVehicleError } = await supabase
      .from("vehicles")
      .insert({
        vendor_id: input.vendorId,
        vehicle_type_id: input.vehicleTypeId,
        registration_number: input.vehicleNumber,
        model: input.vehicleModel,
      })
      .select("id")
      .maybeSingle()
    if (insertVehicleError) {
      if (isMissingFleet(insertVehicleError)) {
        return { driverId: driverId ?? "", vehicleId: "" }
      }
      throw new Error(`Failed to insert vehicle: ${insertVehicleError.message}`)
    }
    vehicleId = insertedVehicle?.id as string
  } else {
    await supabase
      .from("vehicles")
      .update({ model: input.vehicleModel, vehicle_type_id: input.vehicleTypeId })
      .eq("id", vehicleId)
  }

    if (driverId && vehicleId) {
    await setPrimaryDriverVehicle(supabase, driverId, vehicleId)
  }

  return { driverId: driverId ?? "", vehicleId: vehicleId ?? "" }
}

const lookupDriverByPhone = async (
  supabase: SupabaseClient,
  vendorId: string,
  phone: string,
): Promise<{
  driverId: string
  vehicleId: string | null
  fullName: string
  phoneE164: string
  vehicleNumber: string
  vehicleModel: string
} | null> => {
  const last10 = phoneLast10(phone)
  const { data: driver, error } = await supabase
    .from("drivers")
    .select("id, full_name, phone_e164")
    .eq("vendor_id", vendorId)
    .eq("phone_last10", last10)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    if (isMissingFleet(error)) return null
    throw new Error(`Failed to look up driver by phone: ${error.message}`)
  }
  if (!driver) return null

  const { data: link } = await supabase
    .from("driver_vehicle_links")
    .select("vehicle_id, vehicles(registration_number, model)")
    .eq("driver_id", driver.id)
    .eq("is_primary", true)
    .maybeSingle()

  const vehicle = Array.isArray(link?.vehicles) ? link?.vehicles[0] : link?.vehicles

  return {
    driverId: driver.id as string,
    vehicleId: (link?.vehicle_id as string | null) ?? null,
    fullName: driver.full_name as string,
    phoneE164: driver.phone_e164 as string,
    vehicleNumber: (vehicle as { registration_number?: string } | null)?.registration_number ?? "TBD",
    vehicleModel: (vehicle as { model?: string } | null)?.model ?? "Vehicle",
  }
}

const isMissingFleet = (error: { code?: string; message: string }): boolean => {
  const code = error.code ?? ""
  const message = error.message.toLowerCase()
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    ((message.includes("drivers") || message.includes("vehicles") || message.includes("driver_vehicle_links")) &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")))
  )
}

const setPrimaryDriverVehicle = async (
  supabase: SupabaseClient,
  driverId: string,
  vehicleId: string,
): Promise<void> => {
  const { error: clearError } = await supabase
    .from("driver_vehicle_links")
    .update({ is_primary: false })
    .eq("driver_id", driverId)
    .eq("is_primary", true)
    .neq("vehicle_id", vehicleId)
  if (clearError && !isMissingFleet(clearError)) {
    throw new Error(`Failed to clear previous primary vehicle: ${clearError.message}`)
  }

  const { error: upsertError } = await supabase.from("driver_vehicle_links").upsert(
    { driver_id: driverId, vehicle_id: vehicleId, is_primary: true },
    { onConflict: "driver_id,vehicle_id" },
  )
  if (upsertError && !isMissingFleet(upsertError)) {
    throw new Error(`Failed to set primary vehicle: ${upsertError.message}`)
  }
}

const attachBooking = async (
  supabase: SupabaseClient,
  booking: ResolvedBooking,
  driver: {
    driverId: string
    vehicleId: string | null
    fullName: string
    phoneE164: string
    vehicleNumber: string
    vehicleModel: string
  },
  rawMessage: string,
  waMessageId?: string,
): Promise<void> => {
  const { error: insertError } = await supabase.from("driver_detail_submissions").insert({
    booking_id: booking.bookingId,
    vendor_id: booking.vendorId,
    raw_message_text: rawMessage,
    parsed_driver_name: driver.fullName,
    parsed_driver_phone: driver.phoneE164,
    parsed_vehicle_number: driver.vehicleNumber,
    parsed_vehicle_model: driver.vehicleModel,
    parse_status: "parsed_ok",
    wa_message_id: waMessageId,
    parsed_at: new Date().toISOString(),
  })
  if (insertError) throw new Error(`Failed to record parsed_ok submission: ${insertError.message}`)

  const update: Record<string, unknown> = { status: "driver_attached" }
  if (driver.driverId) update.driver_id = driver.driverId
  if (driver.vehicleId) update.vehicle_id = driver.vehicleId

  const { data: updated, error: updateError } = await supabase
    .from("bookings")
    .update(update)
    .eq("id", booking.bookingId)
    .in("status", ACTIVE_VENDOR_BOOKING_STATUSES)
    .select("id")
    .maybeSingle()
  if (updateError) throw new Error(`Failed to update booking to driver_attached: ${updateError.message}`)
  if (!updated?.id) return

  if (booking.lockType === "token_99") {
    await enqueueJob(supabase, "send_balance_payment", { booking_id: booking.bookingId })
    return
  }
  await enqueueJob(supabase, "send_confirmation_card", { booking_id: booking.bookingId })
}

export const handleParseDriverDetails = async (
  supabase: SupabaseClient,
  payload: ParseDriverDetailsPayload,
): Promise<void> => {
  const raw = (payload.raw_message_text ?? "").trim()
  const resolved = await findActiveBookingForVendorPhone(supabase, payload.from_phone)

  if (!resolved) {
    if (shouldOpsAlertUnresolvedSender(raw)) {
      await enqueueJob(supabase, "ops_alert", {
        reason: "driver_details_unresolved_vendor_or_booking",
        from_phone: payload.from_phone,
        raw_message_text: raw,
        wa_message_id: payload.wa_message_id,
      })
    }
    return
  }

  if (
    (ATTACHED_OR_LATER_BOOKING_STATUSES as readonly string[]).includes(resolved.status) ||
    resolved.paymentStatus === "fully_paid"
  ) {
    return
  }

  const match = raw.match(DRIVER_DETAILS_REGEX)
  if (match) {
    const [, name, phone, vehicleNumber, vehicleModel] = match
    const upserted = await upsertDriverAndVehicle(supabase, {
      vendorId: resolved.vendorId,
      name: name.trim(),
      phone: phone.trim(),
      vehicleNumber: vehicleNumber.trim(),
      vehicleModel: vehicleModel.trim(),
      vehicleTypeId: resolved.vehicleTypeId,
    })
    await attachBooking(
      supabase,
      resolved,
      {
        driverId: upserted.driverId,
        vehicleId: upserted.vehicleId || null,
        fullName: name.trim(),
        phoneE164: toDriverPhoneE164(phone.trim()),
        vehicleNumber: vehicleNumber.trim(),
        vehicleModel: vehicleModel.trim(),
      },
      raw,
      payload.wa_message_id,
    )
    return
  }

  const digits = raw.replace(/\D/g, "")
  const isPhoneOnly = /^\+?[\d\s\-()]{10,20}$/.test(raw) && digits.length >= 10 && digits.length <= 13
  if (isPhoneOnly) {
    const driver = await lookupDriverByPhone(supabase, resolved.vendorId, raw)
    if (!driver) {
      const { error: insertError } = await supabase.from("driver_detail_submissions").insert({
        booking_id: resolved.bookingId,
        vendor_id: resolved.vendorId,
        raw_message_text: raw,
        parse_status: "parse_failed",
        wa_message_id: payload.wa_message_id,
      })
      if (insertError) throw new Error(`Failed to record parse_failed submission: ${insertError.message}`)
      await enqueueJob(supabase, "ops_alert", {
        reason: "unmatched_driver",
        booking_id: resolved.bookingId,
        vendor_id: resolved.vendorId,
        raw_message_text: raw,
        wa_message_id: payload.wa_message_id,
      })
      return
    }
    await attachBooking(supabase, resolved, driver, raw, payload.wa_message_id)
    return
  }

  if (DRIVER_DETAILS_PREFIX_REGEX.test(raw)) {
    const { error: insertError } = await supabase.from("driver_detail_submissions").insert({
      booking_id: resolved.bookingId,
      vendor_id: resolved.vendorId,
      raw_message_text: raw,
      parse_status: "parse_failed",
      wa_message_id: payload.wa_message_id,
    })
    if (insertError) throw new Error(`Failed to record parse_failed submission: ${insertError.message}`)
    await enqueueJob(supabase, "ops_alert", {
      reason: "driver_details_parse_failed",
      booking_id: resolved.bookingId,
      vendor_id: resolved.vendorId,
      raw_message_text: raw,
      wa_message_id: payload.wa_message_id,
    })
  }
}
