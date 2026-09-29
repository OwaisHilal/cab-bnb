"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  clearCachedGuestTrip,
  currentGuestTripEpoch,
  fetchGuestTrip,
  guestTripCacheIsFresh,
  guestTripIsKnownMissing,
  guestTripSnapshotKey,
  readCachedGuestTrip,
} from "@/features/guest-trip/guestTripClient"
import type { GuestStep, GuestTripSnapshot } from "@/lib/guest-trip/types"

const FAST_POLL_MS = 3000
const SLOW_POLL_MS = 15000

type Confirming = "token" | "balance" | null

interface AheadStep {
  step: "token_received" | "driver_contact"
  bodyText: string
  driverPhone: string | null
  driverName: string | null
  vehicleLabel: string | null
  vehicleNumber: string | null
  operatorName: string | null
  footerText: string | null
  rideGroupInviteUrl: string | null
}

export const useGuestTrip = (sessionId: string, confirming: Confirming, active = true) => {
  const [snapshot, setSnapshot] = useState<GuestTripSnapshot | null>(() => readCachedGuestTrip(sessionId))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [localConfirming, setLocalConfirming] = useState<Confirming>(confirming)
  const [missing, setMissing] = useState(() => (sessionId ? guestTripIsKnownMissing(sessionId) : false))
  const [ahead, setAhead] = useState<AheadStep | null>(null)
  const snapshotRef = useRef<GuestTripSnapshot | null>(snapshot)
  const stepRef = useRef<GuestStep | null>(snapshot?.step ?? null)
  const confirmingPaymentRef = useRef(false)
  const appliedEpochRef = useRef(0)
  const sessionRef = useRef(sessionId)
  const sessionSeenRef = useRef(sessionId)
  sessionRef.current = sessionId
  if (sessionSeenRef.current !== sessionId) {
    sessionSeenRef.current = sessionId
    const next = readCachedGuestTrip(sessionId)
    snapshotRef.current = next
    stepRef.current = next?.step ?? null
    setSnapshot(next)
  }
  const cachedNow = sessionId ? readCachedGuestTrip(sessionId) : null
  if (cachedNow && snapshot === null) {
    snapshotRef.current = cachedNow
    stepRef.current = cachedNow.step
    setSnapshot(cachedNow)
  } else if (!cachedNow && sessionId && guestTripIsKnownMissing(sessionId) && !missing && snapshot === null) {
    setMissing(true)
  }

  useEffect(() => {
    if (confirming) setLocalConfirming(confirming)
  }, [confirming])

  const applySnapshot = useCallback((data: GuestTripSnapshot, resultEpoch: number) => {
    if (resultEpoch < appliedEpochRef.current) return
    appliedEpochRef.current = resultEpoch
    const unchanged = snapshotRef.current !== null && guestTripSnapshotKey(snapshotRef.current) === guestTripSnapshotKey(data)
    snapshotRef.current = data
    stepRef.current = data.step
    if (!unchanged) setSnapshot(data)
    setMissing(false)
    setLoadError(null)
    setAhead((current) => (current && data.step === current.step ? null : current))
    if (localConfirming === "token" && data.step !== "lock") setLocalConfirming(null)
    if (localConfirming === "balance" && data.step !== "balance") setLocalConfirming(null)
  }, [localConfirming])

  const refresh = useCallback(async (fresh = false) => {
    if (!sessionId) return
    const requestedSession = sessionId
    try {
      const result = await fetchGuestTrip(sessionId, localConfirming, fresh)
      if (sessionRef.current !== requestedSession) return
      if (!result.ok) {
        if (result.status === 404 && !snapshotRef.current) setMissing(true)
        else setLoadError("Still trying to refresh this trip.")
        return
      }
      applySnapshot(result.snapshot, result.epoch)
    } catch {
      setLoadError("Still trying to refresh this trip.")
    }
  }, [applySnapshot, localConfirming, sessionId])

  useEffect(() => {
    if (!sessionId || !active) return
    let cancelled = false
    let timer = 0
    const cached = readCachedGuestTrip(sessionId)
    if (cached) applySnapshot(cached, appliedEpochRef.current)
    const refreshNow = !guestTripCacheIsFresh(sessionId) && !guestTripIsKnownMissing(sessionId)

    const schedule = () => {
      const fast = confirmingPaymentRef.current || stepRef.current === "quotes_waiting"
      timer = window.setTimeout(() => {
        void run()
      }, fast ? FAST_POLL_MS : SLOW_POLL_MS)
    }
    const run = async () => {
      if (cancelled) return
      if (document.visibilityState === "visible") await refresh()
      if (!cancelled) schedule()
    }
    if (refreshNow) void run()
    else schedule()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, applySnapshot, refresh, sessionId])

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
        await refresh(true)
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
        driverName?: string | null
        vehicleLabel?: string | null
        vehicleNumber?: string | null
        operatorName?: string | null
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
        await refresh(true)
        return
      }
      if (data.outcome === "show_next_step" && data.step) {
        setAhead({
          step: data.step,
          bodyText: data.bodyText ?? "",
          driverPhone: data.driverPhone ?? null,
          driverName: data.driverName ?? null,
          vehicleLabel: data.vehicleLabel ?? null,
          vehicleNumber: data.vehicleNumber ?? null,
          operatorName: data.operatorName ?? null,
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
      stepRef.current = null
      clearCachedGuestTrip(sessionId)
      appliedEpochRef.current = currentGuestTripEpoch()
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
          step: ahead.step,
          bodyText: ahead.bodyText,
          footerText: ahead.footerText,
          driverPhone: ahead.driverPhone,
          driverName: ahead.driverName,
          vehicleLabel: ahead.vehicleLabel,
          vehicleNumber: ahead.vehicleNumber,
          operatorName: ahead.operatorName,
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
  confirmingPaymentRef.current = confirmingPayment
  stepRef.current = snapshot?.step ?? stepRef.current

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
      stepRef.current = null
      if (sessionId) clearCachedGuestTrip(sessionId)
      appliedEpochRef.current = currentGuestTripEpoch()
      setSnapshot(null)
    },
  }
}

export type GuestTripViewStep = GuestStep
