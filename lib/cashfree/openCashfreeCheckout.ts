import { load } from "@cashfreepayments/cashfree-js"
import type { CashfreeCheckoutEnvironment } from "@/lib/cashfree/canLaunchCheckout"

export interface OpenCashfreeCheckoutInput {
  paymentSessionId: string
  returnUrl: string
  environment: CashfreeCheckoutEnvironment
}

export type OpenCashfreeCheckoutResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "cancelled" | "error"; message: string }

/**
 * Opens Cashfree hosted Checkout the same way the /pay/token button does:
 * one load() for the environment the server already used, then checkout().
 * A successful call redirects this tab to returnUrl. Fulfillment still
 * happens only in the Cashfree webhook.
 */
export const openCashfreeCheckout = async (
  input: OpenCashfreeCheckoutInput,
): Promise<OpenCashfreeCheckoutResult> => {
  try {
    const cashfree = await load({ mode: input.environment })
    if (!cashfree) {
      return {
        ok: false,
        reason: "unavailable",
        message: "Payments aren't available in this browser. Please try again.",
      }
    }

    const result = await cashfree.checkout({
      paymentSessionId: input.paymentSessionId,
      returnUrl: input.returnUrl,
      redirectTarget: "_self",
    })

    if (result?.error) {
      return {
        ok: false,
        reason: "cancelled",
        message: result.error.message ?? "Payment was cancelled or failed. Please try again.",
      }
    }

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Something went wrong starting the payment.",
    }
  }
}
