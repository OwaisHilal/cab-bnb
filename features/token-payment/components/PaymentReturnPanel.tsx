"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { paymentOutcomeCopy, type PaymentPanelOutcome } from "@/lib/cashfree/classifyCashfreeAttempt"
import { Spinner } from "@/components/ui/Spinner"
import { InfoIcon } from "@/components/ui/icons"
import { RefreshStatusButton } from "@/features/token-payment/components/RefreshStatusButton"

const UNKNOWN_PAYMENT_WAIT_MS = 45_000
const FAST_POLL_MS = 3000

const TONE_CLASSES = {
  blue: "bg-kmr-blue/10 text-kmr-blue",
  orange: "bg-kmr-orange/10 text-kmr-orange",
} as const

/**
 * Same icon circle and type scale as the payment page's status block.
 * Pending and review keep Pay hidden. Unknown hides Pay for 45 seconds,
 * then offers it while this page keeps asking the server what Cashfree decided.
 */
export function PaymentReturnPanel({
  outcome,
  pay,
  back,
  attemptKey,
}: {
  outcome: PaymentPanelOutcome
  pay: ReactNode
  back: ReactNode
  attemptKey: string
}) {
  const router = useRouter()
  const storageKey = `kmr_unknown_payment_${attemptKey}`
  const [unknownTimedOut, setUnknownTimedOut] = useState(false)
  const keepChecking = outcome === "pending" || outcome === "review" || outcome === "unknown"
  const displayOutcome: PaymentPanelOutcome = outcome === "unknown" && !unknownTimedOut ? "pending" : outcome
  const copy = paymentOutcomeCopy(displayOutcome)

  useEffect(() => {
    const readStartedAt = () => {
      try {
        return sessionStorage.getItem(storageKey)
      } catch {
        return null
      }
    }
    const writeStartedAt = (value: string) => {
      try {
        sessionStorage.setItem(storageKey, value)
      } catch {
        // Private browsing can block storage. The in-memory timer still runs.
      }
    }
    const clearStartedAt = () => {
      try {
        sessionStorage.removeItem(storageKey)
      } catch {
        // Ignore storage failures. The panel still updates from the latest outcome.
      }
    }

    if (outcome !== "unknown") {
      clearStartedAt()
      return
    }
    const existing = readStartedAt()
    const started = existing ? Number(existing) : Date.now()
    if (!existing) writeStartedAt(String(started))
    const remaining = Number.isFinite(started) ? Math.max(0, UNKNOWN_PAYMENT_WAIT_MS - (Date.now() - started)) : UNKNOWN_PAYMENT_WAIT_MS
    if (remaining === 0) {
      setUnknownTimedOut(true)
      return
    }
    const timer = window.setTimeout(() => setUnknownTimedOut(true), remaining)
    return () => window.clearTimeout(timer)
  }, [outcome, storageKey])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      router.refresh()
    }, FAST_POLL_MS)
    return () => window.clearInterval(timer)
  }, [router])

  return (
    <div role="status" className="flex flex-col items-center gap-3 text-center animate-kmr-reveal">
      <span className={`flex size-16 items-center justify-center rounded-full ${TONE_CLASSES[copy.tone]}`}>
        {copy.tone === "blue" ? <Spinner tone="blue" size="lg" /> : <InfoIcon size={30} />}
      </span>
      <h1 className="font-archivo text-[26px] font-extrabold leading-[1.15] tracking-[-0.6px] text-kmr-ink">{copy.title}</h1>
      <p className="font-archivo text-sm font-medium leading-[1.55] text-kmr-muted-1">{copy.description}</p>
      <div className="mt-2 flex flex-col items-center gap-3">
        {keepChecking ? <RefreshStatusButton /> : null}
        {copy.showPay ? pay : null}
        {back}
      </div>
    </div>
  )
}
