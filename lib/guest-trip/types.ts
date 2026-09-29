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
  step?: GuestStep
  hasPaidToken?: boolean
  hasTakenMoney?: boolean
}

export interface GuestTripSnapshot {
  tripRequestId: string
  step: GuestStep
  tripSummary: string
  quotes: Array<{
    id: string
    vendorName: string
    line: string
    pricePerDay: number
    rating: number | null
    isBestPrice: boolean
  }>
  bodyText: string
  hidePay: boolean
  paymentCrqid: string | null
  driverPhone: string | null
  driverName: string | null
  vehicleLabel: string | null
  vehicleNumber: string | null
  operatorName: string | null
  dayLines: string[]
  pricePerDay: number | null
  tokenAmount: number | null
  balanceAmount: number | null
  totalAmount: number | null
  footerText: string | null
  rideGroupInviteUrl: string | null
  resumedExisting: boolean
}
