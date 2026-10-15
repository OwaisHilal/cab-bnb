import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { shouldOpenReturnOtp, type ReturnLookupState } from "@/lib/booking/shouldOpenReturnOtp"

const ready = (overrides: Partial<ReturnLookupState> = {}): ReturnLookupState => ({
  continueRequested: true,
  directLookup: "missing",
  cookieLookup: "absent",
  tripFound: false,
  phoneEmailResumeApplied: false,
  ...overrides,
})

describe("shouldOpenReturnOtp", () => {
  it("stays closed while either lookup is still pending", () => {
    assert.equal(shouldOpenReturnOtp(ready({ directLookup: "pending" })), false)
    assert.equal(shouldOpenReturnOtp(ready({ cookieLookup: "pending" })), false)
  })

  it("stays closed when either lookup found a trip", () => {
    assert.equal(shouldOpenReturnOtp(ready({ directLookup: "found" })), false)
    assert.equal(shouldOpenReturnOtp(ready({ cookieLookup: "found" })), false)
    assert.equal(shouldOpenReturnOtp(ready({ tripFound: true })), false)
  })

  it("stays closed when the cookie request failed but the direct fetch found the trip", () => {
    assert.equal(
      shouldOpenReturnOtp(ready({ directLookup: "found", cookieLookup: "failed" })),
      false,
    )
  })

  it("opens only after both lookups finish without a trip on a payment return", () => {
    assert.equal(shouldOpenReturnOtp(ready()), true)
    assert.equal(shouldOpenReturnOtp(ready({ cookieLookup: "failed" })), true)
    assert.equal(shouldOpenReturnOtp(ready({ continueRequested: false })), false)
    assert.equal(shouldOpenReturnOtp(ready({ phoneEmailResumeApplied: true })), false)
    assert.equal(shouldOpenReturnOtp(ready({ directLookup: "failed" })), false)
  })
})
