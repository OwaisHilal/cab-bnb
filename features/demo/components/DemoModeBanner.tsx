"use client"

import { useEffect, useState } from "react"

export function DemoModeBanner() {
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadStatus = async () => {
      try {
        const response = await fetch("/api/demo/status")
        if (!response.ok || cancelled) return
        const data = (await response.json()) as { otp_code?: string }
        if (typeof data.otp_code === "string") {
          setHint(`Demo flow · OTP ${data.otp_code} · mock WhatsApp chat after verify`)
        }
      } catch {
        // Demo banner hidden when demo mode is off.
      }
    }

    void loadStatus()
    return () => {
      cancelled = true
    }
  }, [])

  if (!hint) return null

  return (
    <div
      className="bg-kmr-ink px-4 py-2 text-center font-mono text-[9px] font-semibold tracking-[1px] text-white"
      role="status"
    >
      {hint}
    </div>
  )
}
