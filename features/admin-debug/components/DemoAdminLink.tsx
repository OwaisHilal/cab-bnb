"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

export function DemoAdminLink() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false

    const checkStatus = async () => {
      try {
        const response = await fetch("/api/admin/debug/status")
        if (!cancelled && response.ok) setEnabled(true)
      } catch {
        // Demo console unavailable — hide link.
      }
    }

    void checkStatus()
    return () => {
      cancelled = true
    }
  }, [])

  if (!enabled) return null

  return (
    <Link
      href="/admin/debug"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-[100px] right-4 z-20 rounded-sm bg-kmr-ink px-3 py-2 font-mono text-[9px] font-semibold tracking-[1px] text-white shadow-lg md:right-[calc(50%-215px+16px)]"
      aria-label="Open demo admin debug console in a new tab"
    >
      OPS DEBUG
    </Link>
  )
}
