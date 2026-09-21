import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isBookingAssignable, type ResolvedVendorBooking } from "./assignDriverToBooking"

const baseBooking: ResolvedVendorBooking = {
  bookingId: "booking-1",
  vendorId: "vendor-1",
  status: "vendor_confirmed",
  lockType: "token_99",
  paymentStatus: "token_paid",
  vehicleTypeId: 1,
}

describe("isBookingAssignable", () => {
  it("is assignable for active vendor-confirming statuses", () => {
    assert.equal(isBookingAssignable({ ...baseBooking, status: "vendor_confirming" }), true)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "vendor_confirmed" }), true)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "driver_attach_pending" }), true)
  })

  it("is not assignable once a driver is already attached or later", () => {
    assert.equal(isBookingAssignable({ ...baseBooking, status: "driver_attached" }), false)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "ready_for_pickup" }), false)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "in_trip" }), false)
    assert.equal(isBookingAssignable({ ...baseBooking, status: "completed" }), false)
  })

  it("is not assignable once fully paid, regardless of status", () => {
    assert.equal(isBookingAssignable({ ...baseBooking, status: "vendor_confirmed", paymentStatus: "fully_paid" }), false)
  })
})
