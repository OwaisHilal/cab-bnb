import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { shouldOpsAlertUnresolvedSender } from "@/lib/whatsapp/paymentReport"
import {
  assignDriverToBooking,
  findActiveBookingForVendorPhone,
  isBookingAssignable,
  lookupDriverByPhone,
} from "@/lib/whatsapp/assignDriverToBooking"

const DRIVER_DETAILS_REGEX =
  /^DRIVER:\s*([^|]+?)\s*\|\s*(\+?\d{10,13})\s*\|\s*([A-Z0-9\- ]+?)\s*\|\s*([^|]+?)(?:\s*\|\s*(.+))?$/i
const DRIVER_DETAILS_PREFIX_REGEX = /^DRIVER:/i

export interface ParseDriverDetailsPayload {
  raw_message_text: string
  from_phone: string
  wa_message_id?: string
}

const enqueueJob = async (
  supabase: SupabaseClient,
  jobType: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const { error } = await supabase.from("job_queue").insert({ job_type: jobType, payload })
  if (error) throw new Error(`Failed to enqueue ${jobType} job: ${error.message}`)
}

/**
 * Vendor-side inbound free-text driver assignment. This is the legacy
 * fallback for vendors who type `DRIVER: <name> | <phone> | <vehicle_number>
 * | <vehicle_model>` (or just the driver's phone, if that driver already
 * exists) instead of using the "Assign driver" web form CTA
 * (app/vendor/assign-driver, lib/whatsapp/notifyVendorBooking.ts). The
 * actual upsert/attach logic lives in assignDriverToBooking.ts so both
 * paths behave identically — this module only resolves which booking an
 * inbound WhatsApp message is about and parses the free-text formats.
 */
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

  if (!isBookingAssignable(resolved)) {
    return
  }

  const match = raw.match(DRIVER_DETAILS_REGEX)
  if (match) {
    const [, name, phone, vehicleNumber, vehicleModel] = match
    await assignDriverToBooking(
      supabase,
      resolved,
      {
        driverName: name.trim(),
        driverPhone: phone.trim(),
        vehicleNumber: vehicleNumber.trim(),
        vehicleModel: vehicleModel.trim(),
      },
      { rawMessageText: raw, waMessageId: payload.wa_message_id },
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
    await assignDriverToBooking(
      supabase,
      resolved,
      {
        driverName: driver.fullName,
        driverPhone: driver.phoneE164,
        vehicleNumber: driver.vehicleNumber,
        vehicleModel: driver.vehicleModel,
      },
      { rawMessageText: raw, waMessageId: payload.wa_message_id },
    )
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
