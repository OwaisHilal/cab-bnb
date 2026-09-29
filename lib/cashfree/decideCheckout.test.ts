import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { decideCheckout } from "@/lib/cashfree/decideCheckout"

describe("decideCheckout", () => {
  it("does not open checkout when our intent is paid", () => {
    assert.equal(decideCheckout({ intentStatus: "paid", cashfreeOrderStatus: "ACTIVE" }), "already_paid")
  })

  it("does not open checkout when Cashfree is ahead of our row", () => {
    assert.equal(decideCheckout({ intentStatus: "sent", cashfreeOrderStatus: "PAID" }), "already_paid")
  })

  it("opens checkout while the order is still active", () => {
    assert.equal(decideCheckout({ intentStatus: "sent", cashfreeOrderStatus: "ACTIVE" }), "open_checkout")
    assert.equal(decideCheckout({ intentStatus: "pending", cashfreeOrderStatus: null }), "open_checkout")
  })
})
