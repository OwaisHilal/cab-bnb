import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createCashfreeOrder } from "@/lib/cashfree/orders"

interface CashfreeOrderStateRow {
  cf_order_id: string | null
  payment_session_id: string | null
  cashfree_order_status: string | null
  cashfree_order_expires_at: string | null
}

/** Don't hand out a Checkout session that is about to expire mid-payment. */
const ORDER_EXPIRY_SAFETY_BUFFER_MS = 2 * 60 * 1000

const isReusableCashfreeOrder = (row: CashfreeOrderStateRow): boolean => {
  if (!row.cf_order_id || !row.payment_session_id) return false
  if (row.cashfree_order_status && row.cashfree_order_status !== "ACTIVE") return false
  if (row.cashfree_order_expires_at) {
    const expiresAtMs = new Date(row.cashfree_order_expires_at).getTime()
    if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() <= ORDER_EXPIRY_SAFETY_BUFFER_MS) {
      return false
    }
  }
  return true
}

/**
 * Create a Cashfree PG Order for a `whatsapp_payment_intents` row, or reuse
 * its still-active one. Shared by the ₹99 token flow
 * (lib/whatsapp/sendTokenPaymentLink.ts) and the balance-due flow
 * (lib/whatsapp/sendBalancePaymentLink.ts) — both hand the resulting
 * `payment_session_id` to the same `/pay/token/<crqid>` page
 * (app/pay/token/[crqid]/page.tsx), and both get matched back to their
 * intent by `app/webhooks/cashfree` via `cf_order_id`.
 *
 * The first order for an intent uses `order_id = crqid` (easy to read in
 * logs/dashboard); if a prior order for the same intent expired/closed, a
 * fresh order gets a short random suffix so Cashfree's own order_id
 * uniqueness requirement never blocks a retry. Either way the resulting
 * `cf_order_id` — not `crqid` — is what app/webhooks/cashfree matches
 * against, so suffixed retries still resolve back to the right intent.
 */
export const ensureCashfreeOrderForIntent = async (
  supabase: SupabaseClient,
  input: {
    crqid: string
    touristPhone: string
    customerNumber: string
    amountInr: number
    returnUrl: string
    notifyUrl: string
  },
): Promise<{ success: boolean; error?: string }> => {
  const { data: existing, error: loadError } = await supabase
    .from("whatsapp_payment_intents")
    .select("cf_order_id, payment_session_id, cashfree_order_status, cashfree_order_expires_at")
    .eq("id", input.crqid)
    .maybeSingle()

  if (loadError) {
    return { success: false, error: `Failed to load Cashfree order state: ${loadError.message}` }
  }

  const existingRow = existing as CashfreeOrderStateRow | null
  if (existingRow && isReusableCashfreeOrder(existingRow)) {
    return { success: true }
  }

  const orderId = existingRow?.cf_order_id ? `${input.crqid}-${randomUUID().slice(0, 8)}` : input.crqid

  const result = await createCashfreeOrder({
    orderId,
    orderAmount: input.amountInr,
    customer: {
      customerId: input.customerNumber,
      customerPhone: input.touristPhone,
    },
    returnUrl: input.returnUrl,
    notifyUrl: input.notifyUrl,
  })

  console.info("[cashfree order] create result", {
    crqid: input.crqid,
    orderId,
    amountInr: input.amountInr,
    success: result.success,
    configured: result.configured,
    error: result.error ?? null,
  })

  if (!result.success) {
    return { success: false, error: result.error ?? "cashfree_order_create_failed" }
  }

  const { error: updateError } = await supabase
    .from("whatsapp_payment_intents")
    .update({
      cf_order_id: result.orderId ?? orderId,
      payment_session_id: result.paymentSessionId ?? null,
      cashfree_order_status: result.orderStatus ?? "ACTIVE",
      cashfree_order_expires_at: result.orderExpiryTime ?? null,
    })
    .eq("id", input.crqid)

  if (updateError) {
    return { success: false, error: `Failed to persist Cashfree order: ${updateError.message}` }
  }

  return { success: true }
}
