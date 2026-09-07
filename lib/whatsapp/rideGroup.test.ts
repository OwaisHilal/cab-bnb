import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  RIDE_GROUP_DRIVER_TEMPLATE_KEY,
  RIDE_GROUP_GUEST_TEMPLATE_KEY,
  RIDE_GROUP_JOIN_BUTTON_TITLE,
  buildDriverRideGroupInvite,
  buildGuestRideGroupInvite,
  buildRideGroupDescription,
  buildRideGroupSubject,
  buildRideGroupWelcomeText,
  firstName,
  formatRidePickupLine,
  isDemoRideGroupId,
  matchRideGroupParticipantRole,
  rideGroupDeleteAt,
} from "./rideGroup"

describe("ride group copy", () => {
  it("names the group from trip, guest, and vendor within 128 characters", () => {
    const subject = buildRideGroupSubject({
      bookingRef: "ABC123",
      guestName: "Abdul Rahman",
      vendorName: "Aala Valley Cabs",
    })
    assert.equal(subject, "Ride ABC123 · Abdul · Aala Valley Cabs")
    assert.ok(subject.length <= 128)
  })

  it("keeps the Join ride group CTA at or under 20 characters", () => {
    assert.ok(RIDE_GROUP_JOIN_BUTTON_TITLE.length <= 20)
    const guest = buildGuestRideGroupInvite({
      bookingRef: "ABC123",
      pickupLine: "Srinagar Airport · 10 Sep, 07:30",
      inviteLink: "https://chat.whatsapp.com/AbCdEfGhIjK",
    })
    assert.equal(guest.templateKey, RIDE_GROUP_GUEST_TEMPLATE_KEY)
    assert.equal(guest.ctaUrl?.title, "Join ride group")
    assert.match(guest.bodyText, /quality-control/)
    assert.match(guest.bodyText, /https:\/\/chat\.whatsapp\.com\/AbCdEfGhIjK/)
    assert.equal(guest.msg91Components?.button_1?.value, "AbCdEfGhIjK")
  })

  it("builds a driver invite that includes the passenger and invite link", () => {
    const driver = buildDriverRideGroupInvite({
      guestName: firstName("Abdul Rahman"),
      pickupLine: "Srinagar Airport · 10 Sep, 07:30",
      inviteLink: "https://chat.whatsapp.com/AbCdEfGhIjK",
    })
    assert.equal(driver.templateKey, RIDE_GROUP_DRIVER_TEMPLATE_KEY)
    assert.match(driver.bodyText, /Passenger: Abdul/)
    assert.match(driver.bodyText, /quality-control/)
    assert.equal(driver.ctaUrl?.url, "https://chat.whatsapp.com/AbCdEfGhIjK")
  })

  it("describes the group as ride-only and auto-closing", () => {
    const description = buildRideGroupDescription({
      bookingRef: "ABC123",
      pickupLine: "Srinagar Airport · 10 Sep, 07:30",
      dropLocation: "Pahalgam",
    })
    assert.match(description, /ride ABC123/)
    assert.match(description, /quality-control/)
    assert.match(description, /closes automatically/)
    const welcome = buildRideGroupWelcomeText({
      bookingRef: "ABC123",
      guestName: "Abdul",
      driverName: "Irfan",
      vehicleLine: "Innova · JK01AA1111",
      pickupLine: "Srinagar Airport · 10 Sep, 07:30",
    })
    assert.match(welcome, /Passenger: Abdul/)
    assert.match(welcome, /Driver: Irfan/)
  })

  it("formats pickup in Asia/Kolkata and deletes 24h after the trip window", () => {
    const line = formatRidePickupLine({
      pickupLocation: "Srinagar Airport",
      pickupAt: "2026-09-10T02:00:00.000Z",
    })
    assert.match(line, /Srinagar Airport ·/)
    const deletedAt = rideGroupDeleteAt("2026-09-10T02:00:00.000Z", 2)
    assert.equal(deletedAt, "2026-09-13T02:00:00.000Z")
  })

  it("matches guest vs driver by last 10 digits", () => {
    assert.equal(matchRideGroupParticipantRole("+919876543210", "+919876543210", "9876500001"), "customer")
    assert.equal(matchRideGroupParticipantRole("9876500001", "+919876543210", "9876500001"), "driver")
    assert.equal(matchRideGroupParticipantRole("919000000000", "+919876543210", "9876500001"), "unknown")
    assert.equal(isDemoRideGroupId("demo-group-abc"), true)
    assert.equal(isDemoRideGroupId("120363412345678901"), false)
  })
})
