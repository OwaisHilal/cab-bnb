import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ParsedCashfreePaymentWebhook,
  ParsedCashfreeWebhook,
  VerifyCashfreeWebhookSignatureInput,
} from "./types";

/**
 * Cashfree webhook parsing + signature verification.
 *
 * `parseCashfreePaymentLinkWebhook` / `CASHFREE_PAYMENT_LINK_EVENT_TYPE`
 * below are the legacy Payment Links (`PAYMENT_LINK_EVENT`) shape from the
 * static-link workaround (docs/cashfree-payment-links-workaround.md,
 * docs/2026-09-14-static-cashfree-link-rollback.md) — kept only so
 * app/webhooks/cashfree/route.ts can still audit-log a stray event from
 * that retired flow. `parseCashfreePaymentWebhook` /
 * `CASHFREE_PAYMENT_SUCCESS_STATUS` below are the current PG Orders
 * (`POST /pg/orders`) payment webhook shape that actually finalizes
 * bookings.
 */
export const CASHFREE_PAYMENT_LINK_EVENT_TYPE = "PAYMENT_LINK_EVENT";

/** `data.payment.payment_status` value that means the order was paid. */
export const CASHFREE_PAYMENT_SUCCESS_STATUS = "SUCCESS";

/** Cashfree webhook timestamps are epoch milliseconds; reject anything wildly stale/future. */
export const CASHFREE_WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickString(value: unknown, key: string): string | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  const found = root[key];
  return typeof found === "string" && found.length > 0 ? found : undefined;
}

function pickNumber(value: unknown, key: string): number | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  const found = root[key];
  return typeof found === "number" ? found : undefined;
}

/** Like `pickNumber`, but also accepts a numeric string (Cashfree mixes both across endpoints/versions). */
function pickNumberLike(value: unknown, key: string): number | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  const found = root[key];
  if (typeof found === "number") return found;
  if (typeof found === "string" && found.trim() !== "" && Number.isFinite(Number(found))) {
    return Number(found);
  }
  return undefined;
}

/** Like `pickString`, but also accepts a number (`cf_order_id`/`cf_payment_id` are numeric on the wire). */
function pickIdLike(value: unknown, key: string): string | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  const found = root[key];
  if (typeof found === "string" && found.length > 0) return found;
  if (typeof found === "number") return String(found);
  return undefined;
}

export function verifyCashfreeWebhookSignature(input: VerifyCashfreeWebhookSignatureInput): boolean {
  if (!input.timestamp || !input.signature || !input.secret) return false;

  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  if (Math.abs(Date.now() - timestampMs) > CASHFREE_WEBHOOK_MAX_SKEW_MS) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}${input.rawBody}`)
    .digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(input.signature);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function parseCashfreePaymentLinkWebhook(payload: unknown): ParsedCashfreeWebhook | null {
  const root = asRecord(payload);
  if (!root) return null;

  const type = typeof root.type === "string" ? root.type : "";
  const eventTime = typeof root.event_time === "string" ? root.event_time : new Date().toISOString();

  const data = asRecord(root.data);
  if (!data) return { type, eventTime, data: null };

  const linkId = pickString(data, "link_id");
  if (!linkId) return { type, eventTime, data: null };

  const linkStatus = pickString(data, "link_status") ?? "";
  const customerDetails = asRecord(data.customer_details);
  const customerPhone = customerDetails ? pickString(customerDetails, "customer_phone") ?? null : null;

  return {
    type,
    eventTime,
    data: {
      linkId,
      linkStatus,
      cfLinkId: pickNumber(data, "cf_link_id"),
      linkAmount: pickString(data, "link_amount"),
      linkAmountPaid: pickString(data, "link_amount_paid"),
      customerPhone,
    },
  };
}

/**
 * PG Orders payment webhook (`PAYMENT_SUCCESS_WEBHOOK` and its
 * FAILED/USER_DROPPED/CANCELLED siblings) — shape is
 * `data.order.{order_id,order_amount,cf_order_id}` +
 * `data.payment.{payment_status,payment_amount,cf_payment_id,bank_reference}`
 * + `data.customer_details.customer_phone`. Branches purely on
 * `payment_status` rather than the top-level `type` string so a
 * differently-named event for the same payload shape still parses.
 */
export function parseCashfreePaymentWebhook(payload: unknown): ParsedCashfreePaymentWebhook | null {
  const root = asRecord(payload);
  if (!root) return null;

  const type = typeof root.type === "string" ? root.type : "";
  const eventTime = typeof root.event_time === "string" ? root.event_time : new Date().toISOString();

  const data = asRecord(root.data);
  if (!data) return { type, eventTime, data: null };

  const order = asRecord(data.order);
  const payment = asRecord(data.payment);
  const orderId = order ? pickString(order, "order_id") : undefined;
  if (!orderId || !payment) return { type, eventTime, data: null };

  const customerDetails = asRecord(data.customer_details);
  const customerPhone = customerDetails ? pickString(customerDetails, "customer_phone") ?? null : null;

  return {
    type,
    eventTime,
    data: {
      orderId,
      cfOrderId: pickIdLike(order, "cf_order_id"),
      orderAmount: pickNumberLike(order, "order_amount"),
      paymentStatus: pickString(payment, "payment_status") ?? "",
      paymentAmount: pickNumberLike(payment, "payment_amount"),
      cfPaymentId: pickIdLike(payment, "cf_payment_id"),
      bankReference: pickString(payment, "bank_reference") ?? null,
      paymentTime: pickString(payment, "payment_time"),
      customerPhone,
    },
  };
}
