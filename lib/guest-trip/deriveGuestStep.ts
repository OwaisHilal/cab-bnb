import type { GuestStep, GuestStepInput } from "@/lib/guest-trip/types"

const CLOSED_TRIP_STATUSES = new Set(["abandoned", "expired"])

export const deriveGuestStep = (input: GuestStepInput): GuestStep => {
  if (CLOSED_TRIP_STATUSES.has(input.tripRequestStatus)) return "closed"
  if (input.balanceConfirmed) return "driver_contact"
  if (input.driverAssigned) return "balance"
  if (input.tokenIntentStatus === "paid") return "token_received"
  if (input.tokenIntentStatus === "pending" || input.tokenIntentStatus === "sent") return "lock"
  if (input.quoteCount > 0) return "quotes"
  return "quotes_waiting"
}

export const isTripInProgress = (input: GuestStepInput): boolean => {
  const step = deriveGuestStep(input)
  return step !== "closed" && step !== "driver_contact"
}
