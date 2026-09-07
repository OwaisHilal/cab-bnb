import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { isDemoMode } from "@/lib/otp/demoMode"
import { toDriverPhoneE164 } from "@/lib/drivers/phone"
import { isMsg91WhatsAppConfigured } from "@/lib/msg91/sendSession"
import { createMsg91WhatsAppGroup, sendMsg91GroupTextMessage } from "@/lib/msg91/sendGroups"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import { deliverAndLogWhatsAppSpec } from "@/lib/whatsapp/deliverAndLogOutbound"
import {
  CREATE_RIDE_GROUP_JOB,
  DELETE_RIDE_GROUP_JOB,
  JOIN_REMINDER_DELAY_MS,
  REMIND_RIDE_GROUP_JOIN_JOB,
  buildDriverRideGroupInvite,
  buildGuestRideGroupInvite,
  buildRideGroupDescription,
  buildRideGroupSubject,
  buildRideGroupWelcomeText,
  firstName,
  formatRidePickupLine,
  isMissingRideGroupRelation,
  rideGroupDeleteAt,
} from "@/lib/whatsapp/rideGroup"

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

const isMissingRelation = isMissingRideGroupRelation

export const enqueueCreateRideGroupJob = async (
  supabase: SupabaseClient,
  bookingId: string,
): Promise<void> => {
  const { data: existing, error } = await supabase
    .from("job_queue")
    .select("id")
    .eq("job_type", CREATE_RIDE_GROUP_JOB)
    .in("status", ["queued", "processing"])
    .filter("payload->>booking_id", "eq", bookingId)
    .limit(1)
    .maybeSingle()
  if (error && !isMissingRelation(error)) {
    throw new Error(`Failed to check ${CREATE_RIDE_GROUP_JOB} queue: ${error.message}`)
  }
  if (existing?.id) return

  const { error: insertError } = await supabase.from("job_queue").insert({
    job_type: CREATE_RIDE_GROUP_JOB,
    payload: { booking_id: bookingId },
  })
  if (insertError) throw new Error(`Failed to enqueue ${CREATE_RIDE_GROUP_JOB}: ${insertError.message}`)
}

const enqueueFollowupIfMissing = async (
  supabase: SupabaseClient,
  jobType: string,
  bookingId: string,
  runAfter: string,
): Promise<void> => {
  const { data: existing } = await supabase
    .from("job_queue")
    .select("id")
    .eq("job_type", jobType)
    .in("status", ["queued", "processing"])
    .filter("payload->>booking_id", "eq", bookingId)
    .limit(1)
    .maybeSingle()
  if (existing?.id) return

  const { error } = await supabase.from("job_queue").insert({
    job_type: jobType,
    payload: { booking_id: bookingId },
    run_after: runAfter,
  })
  if (error) throw new Error(`Failed to enqueue ${jobType}: ${error.message}`)
}

const recordEvent = async (
  supabase: SupabaseClient,
  input: {
    groupId: string
    bookingId: string
    eventType: string
    participantRole?: string
    waId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> => {
  await supabase.from("whatsapp_ride_group_events").insert({
    group_id: input.groupId,
    booking_id: input.bookingId,
    event_type: input.eventType,
    participant_role: input.participantRole ?? "business",
    wa_id: input.waId ?? null,
    metadata: input.metadata ?? {},
  })
}

export const handleCreateRideGroup = async (
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> => {
  const bookingId = payload.booking_id
  if (!bookingId) throw new Error("create_ride_group requires booking_id")

  await ensureMessageTemplates(supabase)

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, status, payment_status, pickup_at, trip_days, tourist_id, vendor_id, trip_request_id, tourists(phone_e164, full_name), vendors(business_name), trip_requests(pickup_location, drop_location)",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)
  if (!booking) throw new Error(`booking ${bookingId} not found`)
  if (booking.payment_status !== "fully_paid" || booking.status !== "ready_for_pickup") {
    return
  }

  const { data: existingGroup, error: groupLookupError } = await supabase
    .from("whatsapp_ride_groups")
    .select("id, msg91_group_id, invite_link, status, welcome_sent_at")
    .eq("booking_id", bookingId)
    .is("deleted_at", null)
    .maybeSingle()

  if (groupLookupError) {
    if (isMissingRelation(groupLookupError)) return
    throw new Error(`Failed to load ride group: ${groupLookupError.message}`)
  }

  if (existingGroup?.status === "invited" || existingGroup?.status === "active") {
    await enqueueFollowupIfMissing(
      supabase,
      REMIND_RIDE_GROUP_JOIN_JOB,
      bookingId,
      new Date(Date.now() + JOIN_REMINDER_DELAY_MS).toISOString(),
    )
    await enqueueFollowupIfMissing(
      supabase,
      DELETE_RIDE_GROUP_JOB,
      bookingId,
      rideGroupDeleteAt(booking.pickup_at as string, booking.trip_days as number),
    )
    return
  }

  const tourist = firstOrSelf(
    booking.tourists as
      | { phone_e164: string; full_name: string | null }
      | { phone_e164: string; full_name: string | null }[]
      | null,
  )
  if (!tourist?.phone_e164) throw new Error(`booking ${bookingId} has no tourist phone`)

  const { data: driverDetail, error: driverError } = await supabase
    .from("driver_detail_submissions")
    .select("parsed_driver_name, parsed_driver_phone, parsed_vehicle_number, parsed_vehicle_model")
    .eq("booking_id", bookingId)
    .in("parse_status", ["parsed_ok", "ops_corrected"])
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (driverError) throw new Error(`Failed to fetch driver details: ${driverError.message}`)
  if (!driverDetail) throw new Error(`booking ${bookingId} has no parsed driver details`)

  const vendorName =
    firstOrSelf(booking.vendors as { business_name: string } | { business_name: string }[] | null)?.business_name ??
    "Operator"
  const trip = firstOrSelf(
    booking.trip_requests as
      | { pickup_location: string | null; drop_location: string | null }
      | { pickup_location: string | null; drop_location: string | null }[]
      | null,
  )
  const pickupLine = formatRidePickupLine({
    pickupLocation: trip?.pickup_location,
    pickupAt: booking.pickup_at as string,
  })
  const bookingRef = booking.booking_ref as string
  const subject = buildRideGroupSubject({
    bookingRef,
    guestName: tourist.full_name,
    vendorName,
  })
  const description = buildRideGroupDescription({
    bookingRef,
    pickupLine,
    dropLocation: trip?.drop_location,
  })

  let groupId = existingGroup?.id as string | undefined
  let msg91GroupId = existingGroup?.msg91_group_id as string | undefined
  let inviteLink = existingGroup?.invite_link as string | undefined

  if (!inviteLink || !msg91GroupId) {
    if (isMsg91WhatsAppConfigured()) {
      const created = await createMsg91WhatsAppGroup({ subject, description })
      if (!created.success || !created.group?.groupId || !created.group.inviteLink) {
        throw new Error(created.error ?? "Failed to create WhatsApp group")
      }
      msg91GroupId = created.group.groupId
      inviteLink = created.group.inviteLink
    } else if (isDemoMode()) {
      msg91GroupId = `demo-group-${bookingId}`
      inviteLink = `https://chat.whatsapp.com/demo${bookingId.replace(/-/g, "").slice(0, 16)}`
    } else {
      throw new Error("MSG91 WhatsApp is required to create a ride group")
    }

    const row = {
      booking_id: bookingId,
      msg91_group_id: msg91GroupId,
      invite_link: inviteLink,
      subject,
      description,
      join_approval_mode: "auto_approve",
      status: "created",
    }

    if (existingGroup?.id) {
      const { error: updateError } = await supabase
        .from("whatsapp_ride_groups")
        .update(row)
        .eq("id", existingGroup.id)
      if (updateError) throw new Error(`Failed to store ride group: ${updateError.message}`)
      groupId = existingGroup.id as string
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("whatsapp_ride_groups")
        .insert(row)
        .select("id")
        .maybeSingle()
      if (insertError?.code === "23505") {
        const { data: raced } = await supabase
          .from("whatsapp_ride_groups")
          .select("id, msg91_group_id, invite_link")
          .eq("booking_id", bookingId)
          .is("deleted_at", null)
          .maybeSingle()
        groupId = (raced?.id as string | undefined) ?? groupId
        msg91GroupId = (raced?.msg91_group_id as string | undefined) ?? msg91GroupId
        inviteLink = (raced?.invite_link as string | undefined) ?? inviteLink
      } else if (insertError) {
        throw new Error(`Failed to store ride group: ${insertError.message}`)
      } else {
        groupId = (inserted?.id as string | undefined) ?? groupId
      }
    }

    if (groupId) {
      await recordEvent(supabase, {
        groupId,
        bookingId,
        eventType: "created",
        metadata: { msg91_group_id: msg91GroupId, subject },
      })
    }
  }

  if (!groupId || !inviteLink || !msg91GroupId) {
    throw new Error("Ride group is missing invite_link after create")
  }

  const guestSpec = buildGuestRideGroupInvite({ bookingRef, pickupLine, inviteLink })
  await deliverAndLogWhatsAppSpec(supabase, {
    phoneE164: tourist.phone_e164,
    spec: guestSpec,
    templateName: guestSpec.templateKey,
    log: {
      tripRequestId: booking.trip_request_id as string,
      bookingId,
      touristId: booking.tourist_id as string,
    },
  })

  const driverPhoneRaw = (driverDetail.parsed_driver_phone as string | null)?.trim()
  if (driverPhoneRaw) {
    const driverSpec = buildDriverRideGroupInvite({
      guestName: firstName(tourist.full_name),
      pickupLine,
      inviteLink,
    })
    try {
      await deliverAndLogWhatsAppSpec(supabase, {
        phoneE164: toDriverPhoneE164(driverPhoneRaw),
        spec: driverSpec,
        templateName: driverSpec.templateKey,
        log: {
          tripRequestId: booking.trip_request_id as string,
          bookingId,
        },
      })
    } catch (error) {
      console.error("[create_ride_group] driver invite failed", error)
    }
  }

  const vehicleLine = [
    (driverDetail.parsed_vehicle_model as string | null) ?? "Vehicle",
    (driverDetail.parsed_vehicle_number as string | null) ?? "TBD",
  ].join(" · ")
  const welcome = buildRideGroupWelcomeText({
    bookingRef,
    guestName: tourist.full_name?.trim() || "Guest",
    driverName: (driverDetail.parsed_driver_name as string | null) ?? "Driver",
    vehicleLine,
    pickupLine,
  })

  if (isMsg91WhatsAppConfigured() && !existingGroup?.welcome_sent_at) {
    const welcomeSend = await sendMsg91GroupTextMessage({ groupId: msg91GroupId, bodyText: welcome })
    if (!welcomeSend.success) {
      console.error("[create_ride_group] welcome message failed", welcomeSend.error)
    } else {
      await supabase
        .from("whatsapp_ride_groups")
        .update({ welcome_sent_at: new Date().toISOString() })
        .eq("id", groupId)
    }
  } else if (isDemoMode() && !existingGroup?.welcome_sent_at) {
    await supabase
      .from("whatsapp_ride_groups")
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq("id", groupId)
  }

  await supabase
    .from("whatsapp_ride_groups")
    .update({ status: "invited", last_error: null })
    .eq("id", groupId)

  await enqueueFollowupIfMissing(
    supabase,
    REMIND_RIDE_GROUP_JOIN_JOB,
    bookingId,
    new Date(Date.now() + JOIN_REMINDER_DELAY_MS).toISOString(),
  )
  await enqueueFollowupIfMissing(
    supabase,
    DELETE_RIDE_GROUP_JOB,
    bookingId,
    rideGroupDeleteAt(booking.pickup_at as string, booking.trip_days as number),
  )
}
