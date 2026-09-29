"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { GuestStep, GuestTripSnapshot } from "@/lib/guest-trip/types"

type Confirming = "token" | "balance" | null

interface AheadStep {
  step: "token_received" | "driver_contact"
  bodyText: string
  driverPhone: string | null
  footerText: string | null
  rideGroupInviteUrl: string | null
}

export const useGuestTrip = (sessionId: string, confirming: Confirming) => {
  const [snapshot, setSnapshot] = useState<GuestTripSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [localConfirming, setLocalConfirming] = useState<Confirming>(confirming)
  const [missing, setMissing] = useState(false)
  const [ahead, setAhead] = useState<AheadStep | null>(null)
  const snapshotRef = useRef<GuestTripSnapshot | null>(null)

  useEffect(() => {
    if (confirming) setLocalConfirming(confirming)
  }, [confirming])

  const refresh = useCallback(async () => {
    if (!sessionId) return
    const params = new URLSearchParams({ session_id: sessionId })
    if (localConfirming) params.set("confirming", localConfirming)
    try {
      const response = await fetch(`/api/guest-trip?${params.toString()}`)
      if (response.status === 404) {
        if (snapshotRef.current) setLoadError("Still trying to refresh this trip.")
        else setMissing(true)
        return
      }
      if (!response.ok) {
        setLoadError("Still trying to refresh this trip.")
        return
      }
      const data = (await response.json()) as GuestTripSnapshot
      snapshotRef.current = data
      setSnapshot(data)
      setMissing(false)
      setLoadError(null)
      setAhead((current) => (current && data.step === current.step ? null : current))
      if (localConfirming === "token" && data.step !== "lock") setLocalConfirming(null)
      if (localConfirming === "balance" && data.step !== "balance") setLocalConfirming(null)
    } catch {
      setLoadError("Still trying to refresh this trip.")
    }
  }, [localConfirming, sessionId])

  useEffect(() => {
    if (!sessionId) return
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [refresh, sessionId])

  const handleSelect = useCallback(
    async (quoteId: string) => {
      setSelecting(true)
      try {
        const response = await fetch("/api/guest-trip/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, quote_snapshot_id: quoteId }),
        })
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) {
          setLoadError(data?.error ?? "Couldn't lock this cab.")
          return
        }
        await refresh()
      } catch {
        setLoadError("Still trying to refresh this trip.")
      } finally {
        setSelecting(false)
      }
    },
    [refresh, sessionId],
  )

  const handlePay = useCallback(async () => {
    const current = snapshotRef.current
    if (!current) return
    setPaying(true)
    try {
      const response = await fetch("/api/guest-trip/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          ...(current.paymentCrqid ? { crqid: current.paymentCrqid } : {}),
        }),
      })
      const data = (await response.json().catch(() => null)) as {
        error?: string
        outcome?: string
        href?: string
        step?: "token_received" | "driver_contact"
        bodyText?: string
        driverPhone?: string | null
        footerText?: string | null
        rideGroupInviteUrl?: string | null
      } | null
      if (!response.ok || !data?.outcome) {
        setLoadError(data?.error ?? "Couldn't start payment.")
        return
      }
      if (data.outcome === "already_paid") {
        setAhead(null)
        setLocalConfirming(null)
        await refresh()
        return
      }
      if (data.outcome === "show_next_step" && data.step) {
        setAhead({
          step: data.step,
          bodyText: data.bodyText ?? "",
          driverPhone: data.driverPhone ?? null,
          footerText: data.footerText ?? null,
          rideGroupInviteUrl: data.rideGroupInviteUrl ?? null,
        })
        return
      }
      if (data.outcome === "confirming") {
        setLocalConfirming(current.step === "balance" ? "balance" : "token")
        return
      }
      if (data.outcome === "checkout" && data.href) {
        window.location.href = data.href
      }
    } catch {
      setLoadError("Still trying to refresh this trip.")
    } finally {
      setPaying(false)
    }
  }, [refresh, sessionId])

  const handleCancel = useCallback(async () => {
    setCancelling(true)
    try {
      const response = await fetch("/api/guest-trip/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setLoadError(data?.error ?? "Couldn't cancel this trip.")
        return false
      }
      snapshotRef.current = null
      setSnapshot(null)
      setAhead(null)
      return true
    } catch {
      setLoadError("Still trying to refresh this trip.")
      return false
    } finally {
      setCancelling(false)
    }
  }, [sessionId])

  const displayed: GuestTripSnapshot | null = snapshot
    ? ahead
      ? {
          ...snapshot,
          bodyText: ahead.bodyText,
          footerText: ahead.footerText,
          driverPhone: ahead.driverPhone,
          rideGroupInviteUrl: ahead.rideGroupInviteUrl,
          hidePay: true,
        }
      : {
          ...snapshot,
          hidePay: snapshot.hidePay || localConfirming === "token" && snapshot.step === "lock" || localConfirming === "balance" && snapshot.step === "balance",
        }
    : null

  const confirmingPayment = Boolean(
    (localConfirming === "token" && snapshot?.step === "lock") ||
      (localConfirming === "balance" && snapshot?.step === "balance"),
  )

  return {
    snapshot: displayed,
    rawStep: snapshot?.step ?? null,
    loadError,
    refresh,
    selecting,
    paying,
    cancelling,
    confirmingPayment,
    missing,
    handleSelect,
    handlePay,
    handleCancel,
    clearSnapshot: () => {
      snapshotRef.current = null
      setSnapshot(null)
    },
  }
}

export type GuestTripViewStep = GuestStep
