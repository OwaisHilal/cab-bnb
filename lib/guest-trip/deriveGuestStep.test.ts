import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { deriveGuestStep, isTripInProgress } from "@/lib/guest-trip/deriveGuestStep"
import type { GuestStepInput } from "@/lib/guest-trip/types"

const base: GuestStepInput = {
  tripRequestStatus: "quotes_sent",
  quoteCount: 0,
  tokenIntentStatus: "none",
  driverAssigned: false,
  balanceIntentStatus: "none",
  balanceConfirmed: false,
}

describe("deriveGuestStep", () => {
  it("waits while no quote rows exist", () => {
    assert.equal(deriveGuestStep(base), "quotes_waiting")
  })

  it("shows quotes when rows exist and no token intent exists", () => {
    assert.equal(deriveGuestStep({ ...base, quoteCount: 2 }), "quotes")
  })

  it("shows lock while the token intent is unpaid", () => {
    assert.equal(deriveGuestStep({ ...base, quoteCount: 2, tokenIntentStatus: "pending" }), "lock")
    assert.equal(deriveGuestStep({ ...base, quoteCount: 2, tokenIntentStatus: "sent" }), "lock")
  })

  it("shows token received after the token is paid and before a driver", () => {
    assert.equal(
      deriveGuestStep({ ...base, quoteCount: 2, tokenIntentStatus: "paid", driverAssigned: false }),
      "token_received",
    )
  })

  it("shows balance after a driver is assigned and the balance is unpaid", () => {
    assert.equal(
      deriveGuestStep({
        ...base,
        quoteCount: 2,
        tokenIntentStatus: "paid",
        driverAssigned: true,
        balanceIntentStatus: "sent",
      }),
      "balance",
    )
  })

  it("shows driver contact only after the balance is confirmed", () => {
    assert.equal(
      deriveGuestStep({
        ...base,
        quoteCount: 2,
        tokenIntentStatus: "paid",
        driverAssigned: true,
        balanceIntentStatus: "paid",
        balanceConfirmed: true,
      }),
      "driver_contact",
    )
  })

  it("closes an abandoned trip even when quotes and a paid token exist", () => {
    assert.equal(
      deriveGuestStep({
        ...base,
        tripRequestStatus: "abandoned",
        quoteCount: 2,
        tokenIntentStatus: "paid",
        driverAssigned: true,
      }),
      "closed",
    )
  })
})

describe("isTripInProgress", () => {
  it("is in progress until the balance is confirmed", () => {
    assert.equal(isTripInProgress({ ...base, quoteCount: 1, tokenIntentStatus: "paid" }), true)
  })

  it("is finished once the balance is confirmed", () => {
    assert.equal(isTripInProgress({ ...base, balanceConfirmed: true }), false)
  })

  it("is not in progress when abandoned", () => {
    assert.equal(isTripInProgress({ ...base, tripRequestStatus: "abandoned", quoteCount: 1 }), false)
  })
})
