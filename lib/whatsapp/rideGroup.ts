import { WHATSAPP_BUTTON_TITLE_MAX } from "@/lib/whatsapp/formatInr"
import { whatsAppInviteCode } from "@/lib/msg91/groupApi"
import type { WhatsAppMessageSpec } from "@/lib/whatsapp/types"

export const RIDE_GROUP_GUEST_TEMPLATE_KEY = "ride_group_guest_v1"
export const RIDE_GROUP_DRIVER_TEMPLATE_KEY = "ride_group_driver_v1"
export const RIDE_GROUP_JOIN_BUTTON_TITLE = "Join ride group"
export const RIDE_GROUP_FOOTER = "Kashmir BnB Cabs"

export const CREATE_RIDE_GROUP_JOB = "create_ride_group"
export const REMIND_RIDE_GROUP_JOIN_JOB = "remind_ride_group_join"
export const DELETE_RIDE_GROUP_JOB = "delete_ride_group"

export const JOIN_REMINDER_DELAY_MS = 30 * 60 * 1000
export const DELETE_AFTER_TRIP_MS = 24 * 60 * 60 * 1000

const SUBJECT_MAX = 128

export function firstName(fullName: string | null | undefined): string {
  const token = (fullName ?? "").trim().split(/\s+/)[0]
  return token || "Guest"
}

export function formatRidePickupLine(input: {
  pickupLocation?: string | null
  pickupAt: string
}): string {
  const when = new Date(input.pickupAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
  const place = (input.pickupLocation ?? "").trim() || "Pickup"
  return `${place} · ${when}`
}

export function buildRideGroupSubject(input: {
  bookingRef: string
  guestName?: string | null
  vendorName?: string | null
}): string {
  const guest = firstName(input.guestName)
  const vendor = (input.vendorName ?? "Operator").trim().slice(0, 28)
  const subject = `Ride ${input.bookingRef} · ${guest} · ${vendor}`
  return subject.slice(0, SUBJECT_MAX)
}

export function buildRideGroupDescription(input: {
  bookingRef: string
  pickupLine: string
  dropLocation?: string | null
}): string {
  const drop = (input.dropLocation ?? "").trim()
  const route = drop ? `${input.pickupLine} → ${drop}` : input.pickupLine
  return [
    `This group is only for ride ${input.bookingRef}.`,
    route,
    "Kashmir BnB is in the group to quality-control communication.",
    "The group closes automatically after the trip.",
  ].join("\n")
}

export function buildRideGroupWelcomeText(input: {
  bookingRef: string
  guestName: string
  driverName: string
  vehicleLine: string
  pickupLine: string
}): string {
  return [
    `Welcome to ride ${input.bookingRef}.`,
    "",
    `Passenger: ${input.guestName}`,
    `Driver: ${input.driverName}`,
    `Vehicle: ${input.vehicleLine}`,
    `Pickup: ${input.pickupLine}`,
    "",
    "Please use this group only for this ride. Kashmir BnB is here to quality-control communication. The group closes automatically after the trip.",
  ].join("\n")
}

const QUALITY_LINE =
  "Joining helps us quality-control the trip and keep an eye on communication."

export function buildGuestRideGroupInvite(input: {
  bookingRef: string
  pickupLine: string
  inviteLink: string
}): WhatsAppMessageSpec {
  const inviteCode = whatsAppInviteCode(input.inviteLink) ?? input.inviteLink
  const bodyText = [
    "Your driver is connected.",
    "",
    "We've created a private WhatsApp group for this ride with your driver.",
    QUALITY_LINE,
    "",
    `Ride: ${input.bookingRef}`,
    `Pickup: ${input.pickupLine}`,
    "",
    `Join the ride group: ${input.inviteLink}`,
  ].join("\n")

  return {
    templateKey: RIDE_GROUP_GUEST_TEMPLATE_KEY,
    bodyText,
    footerText: RIDE_GROUP_FOOTER,
    buttons: [
      {
        id: `JOIN_RIDE_GROUP::${input.bookingRef}`,
        title: RIDE_GROUP_JOIN_BUTTON_TITLE.slice(0, WHATSAPP_BUTTON_TITLE_MAX),
      },
    ],
    ctaUrl: {
      title: RIDE_GROUP_JOIN_BUTTON_TITLE.slice(0, WHATSAPP_BUTTON_TITLE_MAX),
      url: input.inviteLink,
    },
    msg91Components: {
      body_1: { type: "text", value: input.bookingRef },
      body_2: { type: "text", value: input.pickupLine },
      button_1: { type: "text", subtype: "url", value: inviteCode },
    },
    msg91SendMode: "template",
  }
}

export function buildDriverRideGroupInvite(input: {
  guestName: string
  pickupLine: string
  inviteLink: string
}): WhatsAppMessageSpec {
  const inviteCode = whatsAppInviteCode(input.inviteLink) ?? input.inviteLink
  const guestName = input.guestName.trim() || "Guest"
  const bodyText = [
    "New ride assigned.",
    "",
    `Passenger: ${guestName}`,
    `Pickup: ${input.pickupLine}`,
    "",
    "We've created a WhatsApp group with the passenger for this ride.",
    QUALITY_LINE,
    "",
    `Join the ride group: ${input.inviteLink}`,
  ].join("\n")

  return {
    templateKey: RIDE_GROUP_DRIVER_TEMPLATE_KEY,
    bodyText,
    footerText: RIDE_GROUP_FOOTER,
    buttons: [
      {
        id: `JOIN_RIDE_GROUP::driver`,
        title: RIDE_GROUP_JOIN_BUTTON_TITLE.slice(0, WHATSAPP_BUTTON_TITLE_MAX),
      },
    ],
    ctaUrl: {
      title: RIDE_GROUP_JOIN_BUTTON_TITLE.slice(0, WHATSAPP_BUTTON_TITLE_MAX),
      url: input.inviteLink,
    },
    msg91Components: {
      body_1: { type: "text", value: guestName },
      body_2: { type: "text", value: input.pickupLine },
      button_1: { type: "text", subtype: "url", value: inviteCode },
    },
    msg91SendMode: "template",
  }
}

export function rideGroupDeleteAt(pickupAt: string, tripDays: number): string {
  const pickupMs = new Date(pickupAt).getTime()
  const tripMs = Math.max(tripDays, 1) * 24 * 60 * 60 * 1000
  return new Date(pickupMs + tripMs + DELETE_AFTER_TRIP_MS).toISOString()
}

export function isDemoRideGroupId(groupId: string): boolean {
  return groupId.startsWith("demo-group-")
}

export function isMissingRideGroupRelation(error: { code?: string; message: string }): boolean {
  const code = error.code ?? ""
  const message = error.message.toLowerCase()
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("whatsapp_ride_groups") &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")))
  )
}

export function matchRideGroupParticipantRole(
  waId: string | null,
  touristPhone: string | null,
  driverPhone: string | null,
): "customer" | "driver" | "unknown" {
  if (!waId) return "unknown"
  const suffix = waId.replace(/\D/g, "").slice(-10)
  if (!suffix) return "unknown"
  if (touristPhone && touristPhone.replace(/\D/g, "").slice(-10) === suffix) return "customer"
  if (driverPhone && driverPhone.replace(/\D/g, "").slice(-10) === suffix) return "driver"
  return "unknown"
}
