"use client"

import { useState } from "react"
import { load } from "@cashfreepayments/cashfree-js"
import { Button } from "@/components/ui/Button"

export interface CashfreeCheckoutButtonProps {
  paymentSessionId: string
  returnUrl: string
  environment: "sandbox" | "production"
}

/**
 * Opens Cashfree's hosted Checkout for one PG order's `payment_session_id`
 * (lib/cashfree/orders.ts createCashfreeOrder). On success Cashfree itself
 * navigates the whole page to `returnUrl` — this component only surfaces
 * `result.error` (user closed checkout, card declined, etc.) so the
 * tourist isn't left staring at a blank tap target. Fulfillment never
 * happens here; only the signed app/webhooks/cashfree webhook marks a
 * booking paid.
 */
export function CashfreeCheckoutButton({
  paymentSessionId,
  returnUrl,
  environment,
}: CashfreeCheckoutButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePayNow = async () => {
    setLoading(true)
    setError(null)

    try {
      const cashfree = await load({ mode: environment })

      if (!cashfree) {
        setError("Payments aren't available in this browser. Please try again.")
        setLoading(false)
        return
      }

      const result = await cashfree.checkout({
        paymentSessionId,
        returnUrl,
        redirectTarget: "_self",
      })

      if (result?.error) {
        setError(result.error.message ?? "Payment was cancelled or failed. Please try again.")
        setLoading(false)
      }
      // On success Cashfree redirects this same tab to returnUrl — nothing
      // else to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong starting the payment.")
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button type="button" onClick={handlePayNow} loading={loading} loadingLabel="Opening secure checkout…">
        Pay ₹99 now
      </Button>
      {error && (
        <p role="alert" className="font-archivo text-sm text-kmr-orange">
          {error}
        </p>
      )}
    </div>
  )
}
