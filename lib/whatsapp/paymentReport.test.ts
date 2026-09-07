import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { paymentLinkHeaderAttempts, resolvePaymentReportAction, shouldEnqueuePaidFollowup, shouldOpsAlertUnresolvedSender } from "./paymentReport"
import { formatWhatsAppPayButtonTitle } from "./formatInr"

describe("resolvePaymentReportAction", () => {
  const paid = { paid: true, crqid: "crq-1" }

  it("requires paid + crqid", () => {
    assert.equal(resolvePaymentReportAction({ paid: false, crqid: "crq-1" }, "token_lock"), "ignore")
    assert.equal(resolvePaymentReportAction({ paid: true, crqid: null }, "token_lock"), "ignore")
  })

  it("branches on purpose and infers balance from booking_id when purpose is missing", () => {
    assert.equal(resolvePaymentReportAction(paid, "token_lock"), "token_lock")
    assert.equal(resolvePaymentReportAction(paid, "balance"), "balance")
    assert.equal(resolvePaymentReportAction(paid, "other"), "ignore")
    assert.equal(resolvePaymentReportAction(paid, null), "token_lock")
    assert.equal(resolvePaymentReportAction(paid, null, "booking-uuid"), "balance")
  })
})

describe("shouldEnqueuePaidFollowup", () => {
  it("enqueues balance completion until the booking is fully paid", () => {
    assert.equal(shouldEnqueuePaidFollowup({ action: "balance", bookingPaymentStatus: "token_paid" }), true)
    assert.equal(shouldEnqueuePaidFollowup({ action: "balance", bookingPaymentStatus: "fully_paid" }), false)
  })

  it("enqueues token finalize until the quote is already committed", () => {
    assert.equal(shouldEnqueuePaidFollowup({ action: "token_lock", quoteStatus: "sent" }), true)
    assert.equal(shouldEnqueuePaidFollowup({ action: "token_lock", quoteStatus: "finalized" }), false)
  })
})

describe("paymentLinkHeaderAttempts", () => {
  it("retries without a header after an image attempt", () => {
    assert.deepEqual(paymentLinkHeaderAttempts("https://example.com/card.jpg"), [
      "https://example.com/card.jpg",
      undefined,
    ])
    assert.deepEqual(paymentLinkHeaderAttempts(undefined), [undefined])
  })
})

describe("shouldOpsAlertUnresolvedSender", () => {
  it("alerts DRIVER: from an unknown sender and ignores tourist phone-only", () => {
    assert.equal(shouldOpsAlertUnresolvedSender("DRIVER: Bilal | 9876500001 | JK01 | Dzire"), true)
    assert.equal(shouldOpsAlertUnresolvedSender("9876500001"), false)
    assert.equal(shouldOpsAlertUnresolvedSender("Call me at 9876500001"), false)
  })
})

describe("formatWhatsAppPayButtonTitle", () => {
  it("stays within the 20-character interactive label limit", () => {
    assert.ok(formatWhatsAppPayButtonTitle(43901).length <= 20)
    assert.ok(formatWhatsAppPayButtonTitle(99).length <= 20)
  })
})
