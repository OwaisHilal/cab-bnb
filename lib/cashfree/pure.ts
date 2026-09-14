import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CashfreeCredentials,
  CashfreePaymentLinkApiResult,
  CreateCashfreePaymentLinkInput,
  ParsedCashfreeWebhook,
  VerifyCashfreeWebhookSignatureInput,
} from "./types";

/**
 * Cashfree's Orders/S2S API (`/pg/orders`) is what MSG91's `payment_link`
 * interactive type uses under the hood, and it is blocked on this merchant
 * account (`s2s_enabled_not_approved`). The separate Payment Links API
 * (`/pg/links`) is unaffected — see docs/cashfree-payment-links-workaround.md.
 */
export const CASHFREE_BASE_URL = "https://api.cashfree.com";
export const CASHFREE_PAYMENT_LINKS_PATH = "/pg/links";
export const DEFAULT_CASHFREE_API_VERSION = "2025-01-01";

/** Matches the WhatsApp 24h customer-care session window this link is sent inside. */
export const CASHFREE_LINK_EXPIRY_MS = 24 * 60 * 60 * 1000;

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

/**
 * Cashfree's `customer_phone` must be a bare 10-digit Indian number — it
 * rejects `+91XXXXXXXXXX` / `91XXXXXXXXXX`. Our stored numbers are E.164
 * (or already stripped of `+`), so strip both the `+` and a leading `91`
 * country-code pair if present.
 */
export function toCashfreeCustomerPhone(phoneE164: string): string {
  let digits = phoneE164.trim().replace(/^\+/, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  return digits;
}

/** Cashfree's documented `link_expiry_time` example uses a `+05:30`-style offset, not `Z`. */
export function formatCashfreeExpiryTime(date: Date): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(date.getTime() + istOffsetMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = ist.getUTCFullYear();
  const month = pad(ist.getUTCMonth() + 1);
  const day = pad(ist.getUTCDate());
  const hours = pad(ist.getUTCHours());
  const minutes = pad(ist.getUTCMinutes());
  const seconds = pad(ist.getUTCSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;
}

export function buildCashfreeCreatePaymentLinkBody(
  input: CreateCashfreePaymentLinkInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    link_id: input.linkId,
    link_amount: input.amountInr,
    link_currency: "INR",
    link_purpose: input.purpose.trim().slice(0, 500),
    // Explicitly disabled so a customer can't pay less than the fixed token
    // amount and have Cashfree still report a PARTIALLY_PAID success-adjacent
    // state — see docs/cashfree-payment-links-workaround.md edge cases.
    link_partial_payments: false,
    link_expiry_time: input.expiryTime ?? formatCashfreeExpiryTime(new Date(Date.now() + CASHFREE_LINK_EXPIRY_MS)),
    customer_details: {
      customer_phone: toCashfreeCustomerPhone(input.customerPhoneE164),
    },
    // We deliver the link ourselves via WhatsApp; don't let Cashfree also
    // SMS/email the customer.
    link_notify: {
      send_sms: false,
      send_email: false,
    },
  };

  if (input.notes && Object.keys(input.notes).length > 0) {
    body.link_notes = input.notes;
  }

  if (input.notifyUrl) {
    body.link_meta = { notify_url: input.notifyUrl };
  }

  return body;
}

function cashfreeHeaders(credentials: CashfreeCredentials): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-client-id": credentials.appId,
    "x-client-secret": credentials.secretKey,
    "x-api-version": credentials.apiVersion?.trim() || DEFAULT_CASHFREE_API_VERSION,
  };
}

/**
 * A retried `send_token_payment_link` (e.g. after a serverless crash right
 * after Cashfree accepted the create call but before we recorded it) reuses
 * the same `link_id` and gets rejected here — see docs for the exact
 * duplicate-link_id handling.
 */
function isDuplicateLinkIdError(responseBody: unknown): boolean {
  const root = asRecord(responseBody);
  if (!root) return false;
  const message = typeof root.message === "string" ? root.message.toLowerCase() : "";
  const code = typeof root.code === "string" ? root.code.toLowerCase() : "";
  return (
    message.includes("already exist") ||
    message.includes("duplicate") ||
    code.includes("already_exist") ||
    code === "link_already_exists"
  );
}

interface RawCashfreeRequestResult {
  ok: boolean;
  status: number;
  body: unknown;
  networkError?: string;
}

async function requestCashfreeRaw(
  url: string,
  init: { method: "POST" | "GET"; body?: string },
  credentials: CashfreeCredentials,
  fetchImpl: typeof fetch,
): Promise<RawCashfreeRequestResult> {
  try {
    const response = await fetchImpl(url, {
      method: init.method,
      headers: cashfreeHeaders(credentials),
      ...(init.body ? { body: init.body } : {}),
    });
    const body: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      networkError: error instanceof Error ? error.message : "Unknown Cashfree Payment Links error",
    };
  }
}

function toApiResult(raw: RawCashfreeRequestResult): CashfreePaymentLinkApiResult {
  if (raw.networkError) {
    return { configured: true, success: false, error: raw.networkError };
  }
  if (!raw.ok) {
    return {
      configured: true,
      success: false,
      error: `Cashfree Payment Links API returned ${raw.status}: ${JSON.stringify(raw.body)}`,
    };
  }
  const linkUrl = pickString(raw.body, "link_url");
  if (!linkUrl) {
    return {
      configured: true,
      success: false,
      error: `Cashfree Payment Links API response missing link_url: ${JSON.stringify(raw.body)}`,
    };
  }
  return {
    configured: true,
    success: true,
    linkUrl,
    cfLinkId: pickNumber(raw.body, "cf_link_id"),
    linkStatus: pickString(raw.body, "link_status"),
    linkAmountPaid: pickString(raw.body, "link_amount_paid"),
  };
}

export async function getCashfreePaymentLinkWithConfig(
  linkId: string,
  credentials: CashfreeCredentials | null,
  fetchImpl: typeof fetch = fetch,
): Promise<CashfreePaymentLinkApiResult> {
  if (!credentials?.appId || !credentials?.secretKey) {
    return { configured: false, success: false, error: "Cashfree credentials are not configured" };
  }
  const raw = await requestCashfreeRaw(
    `${CASHFREE_BASE_URL}${CASHFREE_PAYMENT_LINKS_PATH}/${encodeURIComponent(linkId)}`,
    { method: "GET" },
    credentials,
    fetchImpl,
  );
  return toApiResult(raw);
}

export async function createCashfreePaymentLinkWithConfig(
  input: CreateCashfreePaymentLinkInput,
  credentials: CashfreeCredentials | null,
  fetchImpl: typeof fetch = fetch,
): Promise<CashfreePaymentLinkApiResult> {
  if (!credentials?.appId || !credentials?.secretKey) {
    return { configured: false, success: false, error: "Cashfree credentials are not configured" };
  }

  const raw = await requestCashfreeRaw(
    `${CASHFREE_BASE_URL}${CASHFREE_PAYMENT_LINKS_PATH}`,
    { method: "POST", body: JSON.stringify(buildCashfreeCreatePaymentLinkBody(input)) },
    credentials,
    fetchImpl,
  );

  // A retried send (e.g. after a serverless crash right after Cashfree
  // accepted the create call but before we recorded it) reuses the same
  // `link_id` and gets rejected here. Fetch the already-created link instead
  // of failing the whole send — see docs/cashfree-payment-links-workaround.md.
  if (!raw.ok && !raw.networkError && isDuplicateLinkIdError(raw.body)) {
    return getCashfreePaymentLinkWithConfig(input.linkId, credentials, fetchImpl);
  }

  return toApiResult(raw);
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
