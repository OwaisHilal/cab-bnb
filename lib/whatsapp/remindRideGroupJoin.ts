import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { toDriverPhoneE164 } from "@/lib/drivers/phone"
import { deliverAndLogWhatsAppSpec } from "@/lib/whatsapp/deliverAndLogOutbound"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import {
  buildDriverRideGroupInvite,
  buildGuestRideGroupInvite,
  firstName,
  formatRidePickupLine,
  isMissingRideGroupRelation,
} from "@/lib/whatsapp/rideGroup"

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export const handleRemindRideGroupJoin = async (
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> => {
  const bookingId = payload.booking_id
  if (!bookingId) throw new Error("remind_ride_group_join requires booking_id")

  await ensureMessageTemplates(supabase)

  const { data: group, error: groupError } = await supabase
    .from("whatsapp_ride_groups")
    .select("id, invite_link, customer_joined_at, driver_joined_at, status")
    .eq("booking_id", bookingId)
    .is("deleted_at", null)
    .maybeSingle()

  if (groupError) {
    if (isMissingRideGroupRelation(groupError)) return
    throw new Error(`Failed to load ride group: ${groupError.message}`)
  }
  if (!group || group.status === "deleted" || group.status === "deleting") return
  if (!group.invite_link) return
  if (group.customer_joined_at && group.driver_joined_at) return

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, pickup_at, tourist_id, trip_request_id, tourists(phone_e164, full_name), trip_requests(pickup_location)",
    )
    .eq("id", bookingId)
    .maybeSingle()
  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)
  if (!booking) return

  const tourist = firstOrSelf(
    booking.tourists as
      | { phone_e164: string; full_name: string | null }
      | { phone_e164: string; full_name: string | null }[]
      | null,
  )
  const trip = firstOrSelf(
    booking.trip_requests as { pickup_location: string | null } | { pickup_location: string | null }[] | null,
  )
  const pickupLine = formatRidePickupLine({
    pickupLocation: trip?.pickup_location,
    pickupAt: booking.pickup_at as string,
  })
  const inviteLink = group.invite_link as string

  if (!group.customer_joined_at && tourist?.phone_e164) {
    const spec = buildGuestRideGroupInvite({
      bookingRef: booking.booking_ref as string,
      pickupLine,
      inviteLink,
    })
    await deliverAndLogWhatsAppSpec(supabase, {
      phoneE164: tourist.phone_e164,
      spec,
      templateName: spec.templateKey,
      log: {
        tripRequestId: booking.trip_request_id as string,
        bookingId,
        touristId: booking.tourist_id as string,
      },
    })
  }

  if (!group.driver_joined_at) {
    const { data: driverDetail } = await supabase
      .from("driver_detail_submissions")
      .select("parsed_driver_phone")
      .eq("booking_id", bookingId)
      .in("parse_status", ["parsed_ok", "ops_corrected"])
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const driverPhone = (driverDetail?.parsed_driver_phone as string | null)?.trim()
    if (driverPhone) {
      const spec = buildDriverRideGroupInvite({
        guestName: firstName(tourist?.full_name),
        pickupLine,
        inviteLink,
      })
      try {
        await deliverAndLogWhatsAppSpec(supabase, {
          phoneE164: toDriverPhoneE164(driverPhone),
          spec,
          templateName: spec.templateKey,
          log: { tripRequestId: booking.trip_request_id as string, bookingId },
        })
      } catch (error) {
        console.error("[remind_ride_group_join] driver reminder failed", error)
      }
    }
  }

  await supabase.from("job_queue").insert({
    job_type: "ops_alert",
    payload: {
      reason: "ride_group_join_pending",
      booking_id: bookingId,
      customer_joined: Boolean(group.customer_joined_at),
      driver_joined: Boolean(group.driver_joined_at),
    },
  })
}
