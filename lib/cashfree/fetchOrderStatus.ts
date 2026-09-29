import "server-only"

import { readCashfreeOrdersContext } from "@/lib/cashfree/orders"

export async function fetchCashfreeOrderStatus(orderId: string): Promise<string | null> {
  const context = readCashfreeOrdersContext()
  if (!context || !orderId.trim()) return null

  let response: Response
  try {
    response = await fetch(`${context.baseUrl}/orders/${encodeURIComponent(orderId)}`, {
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
  if (!response.ok || !responseBody || typeof responseBody !== "object") return null
  const status = (responseBody as Record<string, unknown>).order_status
  return typeof status === "string" ? status : null
}
