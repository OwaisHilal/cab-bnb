import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { canLaunchCheckout } from "@/lib/cashfree/canLaunchCheckout"

const complete = {
  paymentSessionId: "session_abc",
  returnUrl: "https://kashmir.cab/?continue=1&confirming=token&sid=550e8400-e29b-41d4-a716-446655440000",
  environment: "sandbox" as const,
}

describe("canLaunchCheckout", () => {
  it("is true only when session id, return URL, and environment are all present", () => {
    assert.equal(canLaunchCheckout(complete), true)
    assert.equal(canLaunchCheckout({ ...complete, environment: "production" }), true)
  })

  it("is false when the session id or environment is missing", () => {
    assert.equal(canLaunchCheckout({ ...complete, paymentSessionId: undefined }), false)
    assert.equal(canLaunchCheckout({ ...complete, paymentSessionId: "" }), false)
    assert.equal(canLaunchCheckout({ ...complete, returnUrl: undefined }), false)
    assert.equal(canLaunchCheckout({ ...complete, environment: undefined }), false)
    assert.equal(canLaunchCheckout({ ...complete, environment: "staging" }), false)
  })
})
