import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";

import {
  CASHFREE_PAYMENT_LINK_EVENT_TYPE,
  parseCashfreePaymentLinkWebhook,
  parseCashfreePaymentWebhook,
  verifyCashfreeWebhookSignature,
} from "./pure";

describe("verifyCashfreeWebhookSignature", () => {
  it("accepts a signature computed with the documented HMAC-SHA256(timestamp+body) scheme", () => {
    const secret = "webhook-secret";
    const rawBody = JSON.stringify({ type: "PAYMENT_LINK_EVENT" });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}${rawBody}`)
      .digest("base64");

    assert.equal(verifyCashfreeWebhookSignature({ rawBody, timestamp, signature, secret }), true);
  });

  it("rejects a tampered body", () => {
    const secret = "webhook-secret";
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}${JSON.stringify({ type: "PAYMENT_LINK_EVENT" })}`)
      .digest("base64");

    assert.equal(
      verifyCashfreeWebhookSignature({
        rawBody: JSON.stringify({ type: "TAMPERED" }),
        timestamp,
        signature,
        secret,
      }),
      false,
    );
  });

  it("rejects a stale timestamp outside the allowed skew", () => {
    const secret = "webhook-secret";
    const rawBody = JSON.stringify({ type: "PAYMENT_LINK_EVENT" });
    const staleTimestamp = String(Date.now() - 10 * 60 * 1000);
    const signature = createHmac("sha256", secret)
      .update(`${staleTimestamp}${rawBody}`)
      .digest("base64");

    assert.equal(
      verifyCashfreeWebhookSignature({ rawBody, timestamp: staleTimestamp, signature, secret }),
      false,
    );
  });

  it("rejects when signature or timestamp is missing", () => {
    assert.equal(
      verifyCashfreeWebhookSignature({ rawBody: "{}", timestamp: null, signature: "abc", secret: "s" }),
      false,
    );
    assert.equal(
      verifyCashfreeWebhookSignature({ rawBody: "{}", timestamp: "123", signature: null, secret: "s" }),
      false,
    );
  });
});

describe("parseCashfreePaymentLinkWebhook", () => {
  it("parses a PAID event", () => {
    const parsed = parseCashfreePaymentLinkWebhook({
      type: CASHFREE_PAYMENT_LINK_EVENT_TYPE,
      event_time: "2026-09-14T12:00:00+05:30",
      data: {
        cf_link_id: 14796319,
        link_id: "intent-123",
        link_status: "PAID",
        link_amount: "99.00",
        link_amount_paid: "99.00",
        customer_details: { customer_phone: "7889418789" },
      },
    });

    assert.ok(parsed);
    assert.equal(parsed?.type, CASHFREE_PAYMENT_LINK_EVENT_TYPE);
    assert.equal(parsed?.data?.linkId, "intent-123");
    assert.equal(parsed?.data?.linkStatus, "PAID");
    assert.equal(parsed?.data?.cfLinkId, 14796319);
    assert.equal(parsed?.data?.customerPhone, "7889418789");
  });

  it("returns null data when link_id is missing", () => {
    const parsed = parseCashfreePaymentLinkWebhook({
      type: CASHFREE_PAYMENT_LINK_EVENT_TYPE,
      data: { link_status: "PAID" },
    });
    assert.equal(parsed?.data, null);
  });

  it("returns null for a non-object payload", () => {
    assert.equal(parseCashfreePaymentLinkWebhook("not an object"), null);
    assert.equal(parseCashfreePaymentLinkWebhook(null), null);
  });
});

describe("parseCashfreePaymentWebhook", () => {
  it("parses a PAYMENT_SUCCESS_WEBHOOK event", () => {
    const parsed = parseCashfreePaymentWebhook({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      event_time: "2026-09-17T12:00:00+05:30",
      data: {
        order: { order_id: "crqid-123", order_amount: 99, cf_order_id: 2149460581 },
        payment: {
          payment_status: "SUCCESS",
          payment_amount: 99,
          cf_payment_id: 987654321,
          bank_reference: "REF123",
          payment_time: "2026-09-17T12:00:05+05:30",
        },
        customer_details: { customer_phone: "+917889418789" },
      },
    });

    assert.ok(parsed);
    assert.equal(parsed?.type, "PAYMENT_SUCCESS_WEBHOOK");
    assert.equal(parsed?.data?.orderId, "crqid-123");
    assert.equal(parsed?.data?.cfOrderId, "2149460581");
    assert.equal(parsed?.data?.orderAmount, 99);
    assert.equal(parsed?.data?.paymentStatus, "SUCCESS");
    assert.equal(parsed?.data?.paymentAmount, 99);
    assert.equal(parsed?.data?.cfPaymentId, "987654321");
    assert.equal(parsed?.data?.bankReference, "REF123");
    assert.equal(parsed?.data?.customerPhone, "+917889418789");
  });

  it("parses a FAILED event with a string order_amount", () => {
    const parsed = parseCashfreePaymentWebhook({
      type: "PAYMENT_FAILED_WEBHOOK",
      data: {
        order: { order_id: "crqid-456", order_amount: "99.00" },
        payment: { payment_status: "FAILED", payment_amount: "0.00" },
      },
    });

    assert.equal(parsed?.data?.orderId, "crqid-456");
    assert.equal(parsed?.data?.orderAmount, 99);
    assert.equal(parsed?.data?.paymentStatus, "FAILED");
    assert.equal(parsed?.data?.paymentAmount, 0);
  });

  it("returns null data when order_id or payment is missing", () => {
    assert.equal(
      parseCashfreePaymentWebhook({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: {} } })?.data,
      null,
    );
    assert.equal(
      parseCashfreePaymentWebhook({
        type: "PAYMENT_SUCCESS_WEBHOOK",
        data: { order: { order_id: "crqid-789" } },
      })?.data,
      null,
    );
  });

  it("returns null for a non-object payload", () => {
    assert.equal(parseCashfreePaymentWebhook("not an object"), null);
    assert.equal(parseCashfreePaymentWebhook(null), null);
  });
});
