import "server-only";

import {
  createCashfreePaymentLinkWithConfig,
  getCashfreePaymentLinkWithConfig,
} from "./pure";
import type {
  CashfreeCredentials,
  CashfreePaymentLinkApiResult,
  CreateCashfreePaymentLinkInput,
} from "./types";

function readCashfreeCredentials(): CashfreeCredentials | null {
  const appId = process.env.CASHFREE_APP_ID?.trim();
  const secretKey = process.env.CASHFREE_SECRET_KEY?.trim();
  if (!appId || !secretKey) return null;
  const apiVersion = process.env.CASHFREE_API_VERSION?.trim();
  return { appId, secretKey, ...(apiVersion ? { apiVersion } : {}) };
}

export function isCashfreeConfigured(): boolean {
  return readCashfreeCredentials() !== null;
}

export async function createCashfreePaymentLink(
  input: CreateCashfreePaymentLinkInput,
): Promise<CashfreePaymentLinkApiResult> {
  return createCashfreePaymentLinkWithConfig(input, readCashfreeCredentials());
}

export async function getCashfreePaymentLink(linkId: string): Promise<CashfreePaymentLinkApiResult> {
  return getCashfreePaymentLinkWithConfig(linkId, readCashfreeCredentials());
}

/** Full webhook URL to pass as `link_meta.notify_url` — unset means Cashfree won't call us back for that link. */
export function getCashfreeWebhookNotifyUrl(): string | undefined {
  return process.env.CASHFREE_WEBHOOK_NOTIFY_URL?.trim() || undefined;
}

/** Webhook HMAC secret is the same `x-client-secret` used to authenticate outbound calls (Cashfree's documented scheme). */
export function getCashfreeWebhookSecret(): string | undefined {
  return process.env.CASHFREE_SECRET_KEY?.trim() || undefined;
}
