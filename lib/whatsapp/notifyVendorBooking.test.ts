import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import { buildVendorAssignDriverMessage, buildVendorAssignTokenAndUrl } from "./notifyVendorBooking"

const ORIGINAL_SECRET = process.env.VENDOR_ASSIGN_SECRET

beforeEach(() => {
  process.env.VENDOR_ASSIGN_SECRET = "test-vendor-assign-secret"
})

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.VENDOR_ASSIGN_SECRET
  else process.env.VENDOR_ASSIGN_SECRET = ORIGINAL_SECRET
})

describe("buildVendorAssignTokenAndUrl", () => {
  it("derives the url from the same token it returns", () => {
    const { token, url } = buildVendorAssignTokenAndUrl({ bookingId: "booking-1", vendorId: "vendor-1" })
    assert.ok(token.includes("."))
    assert.equal(url, `https://cab-bnb.vercel.app/vendor/assign-driver?token=${encodeURIComponent(token)}`)
  })
})

describe("buildVendorAssignDriverMessage", () => {
  it("wires the signed token as button_1's dynamic url suffix (vendor_assign_driver_v2)", () => {
    const spec = buildVendorAssignDriverMessage({
      guestName: "Rahul Sharma",
      pickupLocation: "Srinagar",
      dropLocation: "Pahalgam",
      pickupAt: "2026-08-14T09:00:00.000Z",
      tripDays: 3,
      paxCount: 4,
      vehicleLabel: "Sedan",
      tripTotal: 52500,
      assignUrl: "https://cab-bnb.vercel.app/vendor/assign-driver?token=sample-token",
      assignToken: "sample-token",
    })

    assert.equal(spec.msg91Components?.button_1?.subtype, "url")
    assert.equal(spec.msg91Components?.button_1?.type, "text")
    assert.equal(spec.msg91Components?.button_1?.value, "sample-token")
    assert.equal(spec.msg91SendMode, "template")
    assert.equal(spec.ctaUrl?.url, "https://cab-bnb.vercel.app/vendor/assign-driver?token=sample-token")
  })
})
