"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"

/**
 * Re-runs the server component so it re-reads `whatsapp_payment_intents`
 * — used after a tourist returns from Cashfree Checkout while
 * app/webhooks/cashfree may still be catching up. Never marks anything
 * paid itself; it only re-fetches the current state.
 */
export function RefreshStatusButton() {
  const router = useRouter()
  const [checking, setChecking] = useState(false)

  const handleCheckAgain = () => {
    setChecking(true)
    router.refresh()
    window.setTimeout(() => setChecking(false), 1500)
  }

  return (
    <Button type="button" variant="secondary" onClick={handleCheckAgain} loading={checking} loadingLabel="Checking…">
      Check again
    </Button>
  )
}
