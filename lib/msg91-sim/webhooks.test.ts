import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildInboundWebhookPayload, buildOutboundWebhookPayload, buildPaymentWebhookPayload } from "./webhookPayload"

describe("webhook payloads", () => {
  it("stringifies outbound content and sets direction 1", () => {
    const payload = buildOutboundWebhookPayload({
      eventName: "delivered",
      customerNumber: "919876543210",
      integratedNumber: "919999988888",
      requestId: "abc",
      uuid: "wamid.X",
      templateName: "otp_verification",
      content: { body_1: { type: "text", text: "1234" } },
      requestedAt: "2026-09-02T12:00:00+05:30",
      ts: "2026-09-02T12:00:05+05:30",
    })
    assert.equal(payload.direction, "1")
    assert.equal(payload.eventName, "delivered")
    assert.equal(typeof payload.content, "string")
    assert.match(String(payload.content), /body_1/)
  })

  it("stringifies inbound button and messages", () => {
    const payload = buildInboundWebhookPayload({
      customerNumber: "919876543210",
      integratedNumber: "919999988888",
      uuid: "wamid.IN",
      requestId: "req",
      button: { payload: "BOOK_TOKEN::uuid", text: "Pay ₹99 to Lock" },
      contentType: "interactive",
      ts: "2026-09-02T12:00:00+05:30",
    })
    assert.equal(payload.direction, "0")
    assert.equal(typeof payload.button, "string")
    assert.equal(typeof payload.messages, "string")
    assert.equal(typeof payload.interactive, "string")
    assert.match(String(payload.button), /BOOK_TOKEN::uuid/)
    assert.match(String(payload.interactive), /button_reply/)
  })

  it("builds On Payment Report Received fields", () => {
    const payload = buildPaymentWebhookPayload({
      customerNumber: "919876543210",
      integratedNumber: "919999988888",
      uuid: "wamid.PAY",
      requestId: "req-pay",
      crqid: "11111111-1111-4111-8111-111111111111",
      paymentStatus: "paid",
      ts: "2026-09-03T12:00:00+05:30",
    })
    assert.equal(payload.eventName, "payment")
    assert.equal(payload.paymentStatus, "paid")
    assert.equal(payload.crqid, "11111111-1111-4111-8111-111111111111")
    assert.match(String(payload.orders), /paid/)
  })
})
