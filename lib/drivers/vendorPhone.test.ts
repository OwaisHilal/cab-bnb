import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  pickPreferredVendorBooking,
  vendorWhatsAppLookupValues,
  vendorWhatsAppOrFilter,
} from "./vendorPhone"

describe("vendorWhatsAppLookupValues", () => {
  it("covers E.164 and digits-only vendor numbers for a last-10", () => {
    assert.deepEqual(vendorWhatsAppLookupValues("9876500001"), [
      "+919876500001",
      "919876500001",
      "9876500001",
      "+9876500001",
    ])
    assert.match(vendorWhatsAppOrFilter("9876500001"), /whatsapp_number\.eq\.\+919876500001/)
  })
})

describe("pickPreferredVendorBooking", () => {
  it("prefers a waiting booking over an already-attached one", () => {
    const picked = pickPreferredVendorBooking([
      { status: "driver_attach_pending", id: "waiting" },
      { status: "ready_for_pickup", id: "done" },
    ])
    assert.equal(picked?.id, "waiting")
  })

  it("falls back to the latest attached booking so attach can no-op", () => {
    const picked = pickPreferredVendorBooking([{ status: "ready_for_pickup", id: "done" }])
    assert.equal(picked?.id, "done")
  })
})
