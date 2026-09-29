export type GuestStep =
  | "quotes_waiting"
  | "quotes"
  | "lock"
  | "token_received"
  | "balance"
  | "driver_contact"
  | "closed"

export type GuestPaymentIntentStatus = "none" | "pending" | "sent" | "paid" | "failed" | "expired"

export interface GuestStepInput {
  tripRequestStatus: string
  quoteCount: number
  tokenIntentStatus: GuestPaymentIntentStatus
  driverAssigned: boolean
  balanceIntentStatus: GuestPaymentIntentStatus
  balanceConfirmed: boolean
}

export interface GuestTripCandidate {
  id: string
  createdAt: string
  inProgress: boolean
  finished: boolean
  closed: boolean
}

export interface GuestTripSnapshot {
  tripRequestId: string
  step: GuestStep
  tripSummary: string
  quotes: Array<{ id: string; vendorName: string; line: string }>
  bodyText: string
  hidePay: boolean
  paymentCrqid: string | null
  driverPhone: string | null
  footerText: string | null
  rideGroupInviteUrl: string | null
  resumedExisting: boolean
}
