import "server-only"

import type { CreateCashfreeOrderInput, CreateCashfreeOrderResult } from "./types"

const DEFAULT_CASHFREE_API_VERSION = "2023-08-01"
const SANDBOX_BASE_URL = "https://sandbox.cashfree.com/pg"
const PRODUCTION_BASE_URL = "https://api.cashfree.com/pg"

interface CashfreeCredentials {
  clientId: string
  clientSecret: string
  apiVersion: string
}

function readCashfreeCredentials(): CashfreeCredentials | null {
  const clientId = process.env.CASHFREE_CLIENT_ID?.trim()
  const clientSecret = process.env.CASHFREE_SECRET_KEY?.trim()
  if (!clientId || !clientSecret) return null

  return {
    clientId,
    clientSecret,
    apiVersion: process.env.CASHFREE_API_VERSION?.trim() || DEFAULT_CASHFREE_API_VERSION,
  }
}

/** Used by callers that want to short-circuit before touching the network. */
export function isCashfreeOrdersConfigured(): boolean {
  return readCashfreeCredentials() !== null
}

function getCashfreeOrdersBaseUrl(): string {
  const env = process.env.CASHFREE_ENVIRONMENT?.trim().toLowerCase()
  return env === "sandbox" ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL
}

function readErrorMessage(responseBody: unknown, status: number): string {
  if (responseBody && typeof responseBody === "object") {
    const row = responseBody as Record<string, unknown>
    if (typeof row.message === "string" && row.message.length > 0) return row.message
  }
  return `Cashfree order create returned HTTP ${status}`
}

/**
 * Server-only client for Cashfree's PG Orders API (`POST /pg/orders`,
 * `x-api-version: 2023-08-01`). This is a different product from the
 * legacy Payment Links create-API that is blocked on this merchant
 * account (`link_creation_api is not enabled or approved` — see
 * docs/cashfree-payment-links-workaround.md) — PG Orders is what powers
 * Cashfree's own hosted Checkout via `payment_session_id`, so it stays
 * available regardless of that block.
 *
 * Never forward `CASHFREE_SECRET_KEY` to the browser — only the returned
 * `paymentSessionId` for one specific order is safe to hand to the
 * client-side Checkout SDK.
 */
export async function createCashfreeOrder(
  input: CreateCashfreeOrderInput,
): Promise<CreateCashfreeOrderResult> {
  const credentials = readCashfreeCredentials()
  if (!credentials) {
    return {
      success: false,
      configured: false,
      error: "Cashfree PG credentials are not configured (CASHFREE_CLIENT_ID / CASHFREE_SECRET_KEY)",
    }
  }

  const requestBody = {
    order_id: input.orderId,
    order_amount: input.orderAmount,
    order_currency: input.orderCurrency ?? "INR",
    customer_details: {
      customer_id: input.customer.customerId,
      customer_phone: input.customer.customerPhone,
      ...(input.customer.customerEmail ? { customer_email: input.customer.customerEmail } : {}),
      ...(input.customer.customerName ? { customer_name: input.customer.customerName } : {}),
    },
    order_meta: {
      return_url: input.returnUrl,
      notify_url: input.notifyUrl,
    },
  }

  let response: Response
  try {
    response = await fetch(`${getCashfreeOrdersBaseUrl()}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-version": credentials.apiVersion,
        "x-client-id": credentials.clientId,
        "x-client-secret": credentials.clientSecret,
      },
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    return {
      success: false,
      configured: true,
      error: error instanceof Error ? error.message : "Cashfree order create request failed",
    }
  }

  const responseBody: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    return { success: false, configured: true, error: readErrorMessage(responseBody, response.status) }
  }

  const row = (responseBody ?? {}) as Record<string, unknown>
  const cfOrderId =
    typeof row.cf_order_id === "string"
      ? row.cf_order_id
      : typeof row.cf_order_id === "number"
        ? String(row.cf_order_id)
        : undefined

  return {
    success: true,
    configured: true,
    orderId: typeof row.order_id === "string" ? row.order_id : input.orderId,
    cfOrderId,
    paymentSessionId: typeof row.payment_session_id === "string" ? row.payment_session_id : undefined,
    orderStatus: typeof row.order_status === "string" ? row.order_status : undefined,
    orderExpiryTime: typeof row.order_expiry_time === "string" ? row.order_expiry_time : undefined,
  }
}
