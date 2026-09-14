import { createHmac, timingSafeEqual } from "node:crypto";
import type { ParsedCashfreeWebhook, VerifyCashfreeWebhookSignatureInput } from "./types";

/**
 * Cashfree Payment Links webhook parsing + signature verification.
 *
 * Both of Cashfree's automated integration paths are blocked on this
 * merchant account — MSG91's `payment_link` interactive type
 * (`s2s_enabled_not_approved`) and Cashfree's own dynamic Payment Links
 * create-API (`link_creation_api is not enabled or approved`) — so
 * lib/whatsapp/sendTokenPaymentLink.ts sends one dashboard-created static
 * link instead of creating one per booking via this API. What remains here
 * is only what app/api/cashfree/webhook/route.ts needs to verify and log
 * (audit-only) events for that static link. See
 * docs/cashfree-payment-links-workaround.md.
 */
export const CASHFREE_PAYMENT_LINK_EVENT_TYPE = "PAYMENT_LINK_EVENT";

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
