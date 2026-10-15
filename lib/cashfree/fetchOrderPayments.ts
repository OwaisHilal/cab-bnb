import "server-only"

import type { CashfreePaymentAttempt } from "@/lib/cashfree/classifyCashfreeAttempt"
import { readCashfreeOrdersContext } from "@/lib/cashfree/orders"

/**
 * `GET /orders/{order_id}/payments`. null means the request failed.
 * An empty array means the customer left before Cashfree created a payment.
 */
export async function fetchCashfreeOrderPayments(orderId: string): Promise<CashfreePaymentAttempt[] | null> {
  const context = readCashfreeOrdersContext()
  if (!context || !orderId.trim()) return null

  let response: Response
  try {
    response = await fetch(`${context.baseUrl}/orders/${encodeURIComponent(orderId)}/payments`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-version": context.apiVersion,
        "x-client-id": context.clientId,
        "x-client-secret": context.clientSecret,
      },
    })
  } catch {
    return null
  }

  const responseBody: unknown = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(responseBody)) return null

  return responseBody.flatMap((row) => {
    if (!row || typeof row !== "object") return []
    const record = row as Record<string, unknown>
    const paymentStatus = record.payment_status
    if (typeof paymentStatus !== "string" || paymentStatus.length === 0) return []
    const paymentTime = record.payment_time
    return [{
      paymentStatus,
      paymentTime: typeof paymentTime === "string" ? paymentTime : null,
    }]
  })
}
