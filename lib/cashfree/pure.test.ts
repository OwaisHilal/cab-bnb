import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";

import {
  CASHFREE_BASE_URL,
  CASHFREE_PAYMENT_LINKS_PATH,
  CASHFREE_PAYMENT_LINK_EVENT_TYPE,
  DEFAULT_CASHFREE_API_VERSION,
  buildCashfreeCreatePaymentLinkBody,
  createCashfreePaymentLinkWithConfig,
  formatCashfreeExpiryTime,
  getCashfreePaymentLinkWithConfig,
  parseCashfreePaymentLinkWebhook,
  toCashfreeCustomerPhone,
  verifyCashfreeWebhookSignature,
} from "./pure";

const credentials = { appId: "test-app-id", secretKey: "test-secret-key" };

describe("toCashfreeCustomerPhone", () => {
  it("strips a leading + and 91 country code", () => {
    assert.equal(toCashfreeCustomerPhone("+917889418789"), "7889418789");
  });

  it("strips a bare 91-prefixed number without +", () => {
    assert.equal(toCashfreeCustomerPhone("917889418789"), "7889418789");
  });

  it("leaves an already-bare 10-digit number unchanged", () => {
    assert.equal(toCashfreeCustomerPhone("7889418789"), "7889418789");
  });

  it("trims whitespace before normalizing", () => {
    assert.equal(toCashfreeCustomerPhone(" +917889418789 "), "7889418789");
  });
});

describe("formatCashfreeExpiryTime", () => {
  it("formats with a +05:30 offset, not Z", () => {
    const formatted = formatCashfreeExpiryTime(new Date("2026-09-14T10:00:00.000Z"));
    assert.equal(formatted, "2026-09-14T15:30:00+05:30");
  });
});

describe("buildCashfreeCreatePaymentLinkBody", () => {
  it("builds the fixed ₹99 token link body with partial payments disabled", () => {
    const body = buildCashfreeCreatePaymentLinkBody({
      linkId: "intent-123",
      amountInr: 99,
      customerPhoneE164: "+917889418789",
      purpose: "Token lock - Vendor A",
      notifyUrl: "https://example.com/api/cashfree/webhook",
      notes: { quote_snapshot_id: "quote-1", purpose: "token_lock" },
    });

    assert.equal(body.link_id, "intent-123");
    assert.equal(body.link_amount, 99);
    assert.equal(body.link_currency, "INR");
    assert.equal(body.link_partial_payments, false);
    assert.deepEqual(body.customer_details, { customer_phone: "7889418789" });
    assert.deepEqual(body.link_notify, { send_sms: false, send_email: false });
    assert.deepEqual(body.link_meta, { notify_url: "https://example.com/api/cashfree/webhook" });
    assert.deepEqual(body.link_notes, { quote_snapshot_id: "quote-1", purpose: "token_lock" });
    assert.ok(typeof body.link_expiry_time === "string" && body.link_expiry_time.endsWith("+05:30"));
  });

  it("omits link_meta when no notifyUrl is provided", () => {
    const body = buildCashfreeCreatePaymentLinkBody({
      linkId: "intent-456",
      amountInr: 99,
      customerPhoneE164: "+917889418789",
      purpose: "Token lock",
    });
    assert.equal(body.link_meta, undefined);
  });
});

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

describe("createCashfreePaymentLinkWithConfig", () => {
  it("returns configured:false without credentials", async () => {
    const result = await createCashfreePaymentLinkWithConfig(
      { linkId: "x", amountInr: 99, customerPhoneE164: "+917889418789", purpose: "Token" },
      null,
    );
    assert.equal(result.configured, false);
    assert.equal(result.success, false);
  });

  it("posts to the payment links endpoint and returns the link_url on success", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({ link_id: "intent-123", link_url: "https://payments.cashfree.com/links/abc", cf_link_id: 1 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await createCashfreePaymentLinkWithConfig(
      { linkId: "intent-123", amountInr: 99, customerPhoneE164: "+917889418789", purpose: "Token" },
      credentials,
      fetchImpl,
    );

    assert.equal(capturedUrl, `${CASHFREE_BASE_URL}${CASHFREE_PAYMENT_LINKS_PATH}`);
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers["x-client-id"], credentials.appId);
    assert.equal(headers["x-client-secret"], credentials.secretKey);
    assert.equal(headers["x-api-version"], DEFAULT_CASHFREE_API_VERSION);
    assert.equal(result.success, true);
    assert.equal(result.linkUrl, "https://payments.cashfree.com/links/abc");
    assert.equal(result.cfLinkId, 1);
  });

  it("falls back to GET the existing link on a duplicate link_id error", async () => {
    let postCount = 0;
    let getCount = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (init?.method === "GET" || !init?.method) {
        getCount += 1;
        return new Response(
          JSON.stringify({ link_id: "intent-123", link_url: "https://payments.cashfree.com/links/existing" }),
          { status: 200 },
        );
      }
      postCount += 1;
      return new Response(JSON.stringify({ code: "link_already_exists", message: "Link already exists" }), {
        status: 409,
      });
    }) as unknown as typeof fetch;

    const result = await createCashfreePaymentLinkWithConfig(
      { linkId: "intent-123", amountInr: 99, customerPhoneE164: "+917889418789", purpose: "Token" },
      credentials,
      fetchImpl,
    );

    assert.equal(postCount, 1);
    assert.equal(getCount, 1);
    assert.equal(result.success, true);
    assert.equal(result.linkUrl, "https://payments.cashfree.com/links/existing");
  });

  it("returns a failure result for a non-duplicate error", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "invalid customer_phone" }), { status: 400 })) as unknown as typeof fetch;

    const result = await createCashfreePaymentLinkWithConfig(
      { linkId: "intent-123", amountInr: 99, customerPhoneE164: "+917889418789", purpose: "Token" },
      credentials,
      fetchImpl,
    );

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /400/);
  });
});

describe("getCashfreePaymentLinkWithConfig", () => {
  it("returns configured:false without credentials", async () => {
    const result = await getCashfreePaymentLinkWithConfig("intent-123", null);
    assert.equal(result.configured, false);
  });

  it("GETs the link by id", async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          link_id: "intent-123",
          link_url: "https://payments.cashfree.com/links/abc",
          link_status: "PAID",
          link_amount_paid: "99.00",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await getCashfreePaymentLinkWithConfig("intent-123", credentials, fetchImpl);
    assert.equal(capturedUrl, `${CASHFREE_BASE_URL}${CASHFREE_PAYMENT_LINKS_PATH}/intent-123`);
    assert.equal(result.success, true);
    assert.equal(result.linkUrl, "https://payments.cashfree.com/links/abc");
    assert.equal(result.linkStatus, "PAID");
    assert.equal(result.linkAmountPaid, "99.00");
  });
});
