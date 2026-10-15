import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { classifyCashfreeAttempt, paymentOutcomeCopy } from "@/lib/cashfree/classifyCashfreeAttempt"

const at = (paymentStatus: string, paymentTime: string) => ({ paymentStatus, paymentTime })

describe("classifyCashfreeAttempt", () => {
  it("treats an empty payment list on an active order as dropped, not as USER_DROPPED", () => {
    assert.equal(classifyCashfreeAttempt({ orderStatus: "ACTIVE", payments: [] }), "dropped")
  })

  it("uses the latest payment, so a later failure is declined and a later success is paid", () => {
    assert.equal(
      classifyCashfreeAttempt({
        orderStatus: "ACTIVE",
        payments: [at("SUCCESS", "2026-10-15T10:00:00+05:30"), at("FAILED", "2026-10-15T10:05:00+05:30")],
      }),
      "declined",
    )
    assert.equal(
      classifyCashfreeAttempt({
        orderStatus: "ACTIVE",
        payments: [at("FAILED", "2026-10-15T10:00:00+05:30"), at("SUCCESS", "2026-10-15T10:05:00+05:30")],
      }),
      "paid",
    )
  })

  it("keeps a flagged payment in review and a pending payment from being retried", () => {
    assert.equal(
      classifyCashfreeAttempt({ orderStatus: "ACTIVE", payments: [at("FLAGGED", "2026-10-15T10:00:00+05:30")] }),
      "review",
    )
    assert.equal(
      classifyCashfreeAttempt({ orderStatus: "ACTIVE", payments: [at("PENDING", "2026-10-15T10:00:00+05:30")] }),
      "pending",
    )
    assert.equal(
      classifyCashfreeAttempt({ orderStatus: "ACTIVE", payments: [at("INCOMPLETE", "2026-10-15T10:00:00+05:30")] }),
      "pending",
    )
  })

  it("treats an expired order with no successful payment as expired", () => {
    assert.equal(classifyCashfreeAttempt({ orderStatus: "EXPIRED", payments: [] }), "expired")
    assert.equal(
      classifyCashfreeAttempt({
        orderStatus: "TERMINATED",
        payments: [at("USER_DROPPED", "2026-10-15T10:00:00+05:30")],
      }),
      "dropped",
    )
  })

  it("treats a paid order as paid even when the payment list is missing", () => {
    assert.equal(classifyCashfreeAttempt({ orderStatus: "PAID", payments: [] }), "paid")
    assert.equal(classifyCashfreeAttempt({ orderStatus: "PAID", payments: null }), "paid")
  })

  it("is unknown only when the status fetch failed", () => {
    assert.equal(classifyCashfreeAttempt({ orderStatus: null, payments: null }), "unknown")
  })

  it("classifies leaving checkout as dropped", () => {
    for (const paymentStatus of ["USER_DROPPED", "CANCELLED", "NOT_ATTEMPTED", "VOID"]) {
      assert.equal(
        classifyCashfreeAttempt({
          orderStatus: "ACTIVE",
          payments: [at(paymentStatus, "2026-10-15T10:00:00+05:30")],
        }),
        "dropped",
      )
    }
  })
})

describe("paymentOutcomeCopy", () => {
  it("hides pay while the bank is still working and brings it back when the tourist can retry", () => {
    assert.equal(paymentOutcomeCopy("pending").showPay, false)
    assert.equal(paymentOutcomeCopy("review").showPay, false)
    assert.equal(paymentOutcomeCopy("dropped").showPay, true)
    assert.equal(paymentOutcomeCopy("declined").showPay, true)
    assert.equal(paymentOutcomeCopy("expired").showPay, true)
    assert.equal(paymentOutcomeCopy("unknown").showPay, true)
    assert.equal(paymentOutcomeCopy("dropped").title, "Payment wasn't completed.")
    assert.equal(paymentOutcomeCopy("declined").title, "Payment declined.")
    assert.equal(paymentOutcomeCopy("review").title, "Payment is being reviewed.")
  })
})
