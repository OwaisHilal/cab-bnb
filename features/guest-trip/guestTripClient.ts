"use client"

import type { GuestTripSnapshot } from "@/lib/guest-trip/types"

type Confirming = "token" | "balance" | null

export type GuestTripFetchResult =
  | { ok: true; snapshot: GuestTripSnapshot; epoch: number }
  | { ok: false; status: number; epoch: number }

const snapshots = new Map<string, GuestTripSnapshot>()
const cachedAt = new Map<string, number>()
const missingAt = new Map<string, number>()
const inflight = new Map<string, { epoch: number; promise: Promise<GuestTripFetchResult> }>()
let epoch = 0

const FRESH_CACHE_MS = 2000

const requestKey = (sessionId: string, confirming: Confirming): string => {
  return `${sessionId}:${confirming ?? ""}`
}

export const guestTripSnapshotKey = (snapshot: GuestTripSnapshot): string => {
  return JSON.stringify({
    tripRequestId: snapshot.tripRequestId,
    step: snapshot.step,
    tripSummary: snapshot.tripSummary,
    quotes: snapshot.quotes,
    hidePay: snapshot.hidePay,
    paymentCrqid: snapshot.paymentCrqid,
    driverPhone: snapshot.driverPhone,
    driverName: snapshot.driverName,
    vehicleLabel: snapshot.vehicleLabel,
    vehicleNumber: snapshot.vehicleNumber,
    operatorName: snapshot.operatorName,
    dayLines: snapshot.dayLines,
    pricePerDay: snapshot.pricePerDay,
    tokenAmount: snapshot.tokenAmount,
    balanceAmount: snapshot.balanceAmount,
    totalAmount: snapshot.totalAmount,
    footerText: snapshot.footerText,
    rideGroupInviteUrl: snapshot.rideGroupInviteUrl,
  })
}

export const readCachedGuestTrip = (sessionId: string): GuestTripSnapshot | null => {
  return snapshots.get(sessionId) ?? null
}

export const guestTripCacheAge = (sessionId: string): number | null => {
  const at = cachedAt.get(sessionId)
  if (at === undefined) return null
  return Date.now() - at
}

export const guestTripCacheIsFresh = (sessionId: string): boolean => {
  const age = guestTripCacheAge(sessionId)
  return age !== null && age < FRESH_CACHE_MS
}

export const guestTripIsKnownMissing = (sessionId: string): boolean => {
  const at = missingAt.get(sessionId)
  if (at === undefined) return false
  return Date.now() - at < FRESH_CACHE_MS
}

export const currentGuestTripEpoch = (): number => epoch

export const clearCachedGuestTrip = (sessionId: string): void => {
  snapshots.delete(sessionId)
  cachedAt.delete(sessionId)
  missingAt.delete(sessionId)
  epoch += 1
}

const rememberSnapshot = (sessionId: string, snapshot: GuestTripSnapshot, startedEpoch: number): void => {
  if (startedEpoch !== epoch) return
  snapshots.set(sessionId, snapshot)
  cachedAt.set(sessionId, Date.now())
  missingAt.delete(sessionId)
}

export const fetchGuestTrip = (
  sessionId: string,
  confirming: Confirming,
  fresh = false,
): Promise<GuestTripFetchResult> => {
  if (fresh) epoch += 1
  const key = requestKey(sessionId, confirming)
  const current = inflight.get(key)
  if (!fresh && current && current.epoch === epoch) return current.promise

  const startedEpoch = epoch
  const params = new URLSearchParams({ session_id: sessionId })
  if (confirming) params.set("confirming", confirming)

  const promise = fetch(`/api/guest-trip?${params.toString()}`)
    .then(async (response) => {
      if (!response.ok) {
        if (response.status === 404 && startedEpoch === epoch) missingAt.set(sessionId, Date.now())
        return { ok: false as const, status: response.status, epoch: startedEpoch }
      }
      const snapshot = (await response.json()) as GuestTripSnapshot
      rememberSnapshot(sessionId, snapshot, startedEpoch)
      return { ok: true as const, snapshot, epoch: startedEpoch }
    })
    .finally(() => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key)
    })

  inflight.set(key, { epoch: startedEpoch, promise })
  return promise
}
