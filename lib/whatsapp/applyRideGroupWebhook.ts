import type { SupabaseClient } from "@supabase/supabase-js"
import { parseRideGroupWebhook } from "@/lib/msg91/groupApi"
import {
  isMissingRideGroupRelation,
  matchRideGroupParticipantRole,
} from "@/lib/whatsapp/rideGroup"

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export async function applyRideGroupWebhook(
  supabase: SupabaseClient,
  payload: unknown,
): Promise<boolean> {
  const event = parseRideGroupWebhook(payload)
  if (!event) return false
  if (!event.groupId && !event.inviteLink) return false

  let query = supabase
    .from("whatsapp_ride_groups")
    .select("id, booking_id, invite_link, customer_joined_at, driver_joined_at")
    .is("deleted_at", null)

  if (event.groupId) query = query.eq("msg91_group_id", event.groupId)
  else if (event.inviteLink) query = query.eq("invite_link", event.inviteLink)

  const { data: group, error } = await query.maybeSingle()
  if (error) {
    if (isMissingRideGroupRelation(error)) return false
    return false
  }
  if (!group) return Boolean(event.groupId || event.inviteLink)

  const patch: Record<string, unknown> = {}
  if (event.inviteLink && !group.invite_link) patch.invite_link = event.inviteLink

  const resolveRole = async (): Promise<"customer" | "driver" | "unknown"> => {
    const { data: booking } = await supabase
      .from("bookings")
      .select("tourists(phone_e164)")
      .eq("id", group.booking_id)
      .maybeSingle()
    const { data: driverDetail } = await supabase
      .from("driver_detail_submissions")
      .select("parsed_driver_phone")
      .eq("booking_id", group.booking_id)
      .in("parse_status", ["parsed_ok", "ops_corrected"])
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const touristPhone = firstOrSelf(
      (booking as { tourists?: { phone_e164: string } | { phone_e164: string }[] | null } | null)?.tourists ?? null,
    )?.phone_e164
    const driverPhone = (driverDetail?.parsed_driver_phone as string | null) ?? null
    return matchRideGroupParticipantRole(event.waId, touristPhone ?? null, driverPhone)
  }

  if (event.eventType === "join" && event.waId) {
    const role = await resolveRole()

    if (role === "customer" && !group.customer_joined_at) {
      patch.customer_joined_at = new Date().toISOString()
    }
    if (role === "driver" && !group.driver_joined_at) {
      patch.driver_joined_at = new Date().toISOString()
    }
    if (patch.customer_joined_at || patch.driver_joined_at || group.customer_joined_at || group.driver_joined_at) {
      patch.status = "active"
    }

    await supabase.from("whatsapp_ride_group_events").insert({
      group_id: group.id,
      booking_id: group.booking_id,
      event_type: event.eventType,
      participant_role: role,
      wa_id: event.waId,
      metadata: { group_id: event.groupId },
    })
  } else if (event.eventType === "leave" || event.eventType === "remove") {
    const role = event.waId ? await resolveRole() : "unknown"
    await supabase.from("whatsapp_ride_group_events").insert({
      group_id: group.id,
      booking_id: group.booking_id,
      event_type: event.eventType,
      participant_role: role,
      wa_id: event.waId,
      metadata: { group_id: event.groupId },
    })
  }

  if (event.eventType === "created" && event.inviteLink) {
    patch.invite_link = event.inviteLink
  }

  if (Object.keys(patch).length > 0) {
    await supabase.from("whatsapp_ride_groups").update(patch).eq("id", group.id)
  }

  return true
}
