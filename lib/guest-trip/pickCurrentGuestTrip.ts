import type { GuestStep, GuestTripCandidate } from "@/lib/guest-trip/types"

const byNewest = (a: GuestTripCandidate, b: GuestTripCandidate): number => {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

/** Furthest open trip wins: driver contact, then balance, then a paid token, then the newest unpaid trip. */
export const guestTripKeeperRank = (row: GuestTripCandidate): number => {
  if (row.step === "driver_contact" || row.finished) return 0
  if (row.step === "balance") return 1
  if (row.step === "token_received" || row.hasPaidToken) return 2
  return 3
}

export const pickCurrentGuestTrip = <T extends GuestTripCandidate>(rows: T[]): T | null => {
  const open = rows.filter((row) => !row.closed)
  if (open.length === 0) return null
  return [...open].sort((a, b) => {
    const byRank = guestTripKeeperRank(a) - guestTripKeeperRank(b)
    if (byRank !== 0) return byRank
    return byNewest(a, b)
  })[0]
}

export const unpaidDuplicateTripIds = (rows: GuestTripCandidate[], keeperId: string): string[] => {
  return rows
    .filter((row) => !row.closed && row.id !== keeperId && !row.hasPaidToken && !row.hasTakenMoney)
    .map((row) => row.id)
}

export const MONEY_TAKEN_PAYMENT_STATUSES = new Set([
  "token_paid",
  "partially_paid",
  "fully_paid",
  "refund_pending",
  "refunded",
])

export const paymentHasTakenMoney = (paymentStatus: string | null | undefined): boolean => {
  return MONEY_TAKEN_PAYMENT_STATUSES.has(paymentStatus ?? "")
}

export const paymentHasPaidToken = (
  paymentStatus: string | null | undefined,
  tokenStatus: string | null | undefined,
): boolean => {
  if (tokenStatus === "paid") return true
  return paymentStatus === "token_paid" || paymentStatus === "partially_paid" || paymentStatus === "fully_paid"
}

export const keeperStepForPayment = (input: {
  tripRequestStatus: string
  paymentStatus: string | null | undefined
  tokenStatus: string | null | undefined
  driverAssigned: boolean
}): GuestStep => {
  if (input.tripRequestStatus === "abandoned" || input.tripRequestStatus === "expired") return "closed"
  if (input.paymentStatus === "fully_paid") return "driver_contact"
  if (input.driverAssigned) return "balance"
  if (paymentHasPaidToken(input.paymentStatus, input.tokenStatus)) return "token_received"
  return "quotes"
}
