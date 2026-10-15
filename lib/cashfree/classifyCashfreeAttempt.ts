export type CashfreeAttemptClass =
  | "paid"
  | "review"
  | "pending"
  | "declined"
  | "dropped"
  | "expired"
  | "unknown"

export interface CashfreePaymentAttempt {
  paymentStatus: string
  paymentTime?: string | null
}

export interface ClassifyCashfreeAttemptInput {
  orderStatus: string | null
  /** null means the payments request failed. An empty array means no attempt was started. */
  payments: CashfreePaymentAttempt[] | null
}

const EXPIRED_ORDER_STATUSES = new Set(["EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"])
const DROPPED_PAYMENT_STATUSES = new Set(["USER_DROPPED", "CANCELLED", "NOT_ATTEMPTED", "VOID"])

const timeValue = (paymentTime: string | null | undefined): number => {
  if (!paymentTime) return 0
  const parsed = Date.parse(paymentTime)
  return Number.isFinite(parsed) ? parsed : 0
}

const latestPayment = (payments: CashfreePaymentAttempt[]): CashfreePaymentAttempt | null => {
  if (payments.length === 0) return null
  return payments.reduce((latest, payment, index) => {
    const latestTime = timeValue(latest.payment.paymentTime)
    const nextTime = timeValue(payment.paymentTime)
    if (nextTime > latestTime || (nextTime === latestTime && index > latest.index)) {
      return { payment, index }
    }
    return latest
  }, { payment: payments[0], index: 0 }).payment
}

/**
 * Cashfree's return URL is not proof of payment. Order `PAID` or the latest
 * payment row decides what to show. An empty payment list is a leave-before-method,
 * which is not the same as a `USER_DROPPED` payment row.
 */
export const classifyCashfreeAttempt = (input: ClassifyCashfreeAttemptInput): CashfreeAttemptClass => {
  if (input.orderStatus === "PAID") return "paid"
  if (input.payments === null) {
    if (input.orderStatus && EXPIRED_ORDER_STATUSES.has(input.orderStatus)) return "expired"
    return "unknown"
  }

  const latest = latestPayment(input.payments)
  if (latest?.paymentStatus === "SUCCESS") return "paid"
  if (latest?.paymentStatus === "FLAGGED") return "review"
  if (latest?.paymentStatus === "PENDING" || latest?.paymentStatus === "INCOMPLETE") return "pending"
  if (latest?.paymentStatus === "FAILED") return "declined"
  if (latest && DROPPED_PAYMENT_STATUSES.has(latest.paymentStatus)) return "dropped"
  if (!latest && input.orderStatus && EXPIRED_ORDER_STATUSES.has(input.orderStatus)) return "expired"
  if (!latest) return "dropped"
  if (input.orderStatus && EXPIRED_ORDER_STATUSES.has(input.orderStatus)) return "expired"
  return "unknown"
}

export type PaymentPanelOutcome = Exclude<CashfreeAttemptClass, "paid">

export interface PaymentOutcomeCopy {
  title: string
  description: string
  liveLabel: string | null
  tone: "blue" | "orange"
  pulse: boolean
  showPay: boolean
}

const PAYMENT_OUTCOME_COPY: Record<PaymentPanelOutcome, PaymentOutcomeCopy> = {
  pending: {
    title: "Confirming your payment.",
    description: "Please don't close this page or press back. This usually takes a few seconds.",
    liveLabel: "WAITING FOR YOUR BANK",
    tone: "blue",
    pulse: true,
    showPay: false,
  },
  review: {
    title: "Payment is being reviewed.",
    description: "Cashfree is checking this payment. You don't need to pay again. We'll WhatsApp you when it's confirmed.",
    liveLabel: "REVIEWING THIS PAYMENT",
    tone: "blue",
    pulse: true,
    showPay: false,
  },
  dropped: {
    title: "Payment wasn't completed.",
    description: "You left checkout before it finished. Nothing was charged.",
    liveLabel: null,
    tone: "orange",
    pulse: false,
    showPay: true,
  },
  declined: {
    title: "Payment declined.",
    description: "Your bank didn't complete this payment. Nothing was charged. You can try another method.",
    liveLabel: null,
    tone: "orange",
    pulse: false,
    showPay: true,
  },
  expired: {
    title: "Checkout expired.",
    description: "Tap pay to start a new secure checkout.",
    liveLabel: null,
    tone: "orange",
    pulse: false,
    showPay: true,
  },
  unknown: {
    title: "Still confirming.",
    description: "We couldn't reach the bank just now. If you finished paying, stay on this page.",
    liveLabel: null,
    tone: "orange",
    pulse: false,
    showPay: true,
  },
}

export const paymentOutcomeCopy = (outcome: PaymentPanelOutcome): PaymentOutcomeCopy => PAYMENT_OUTCOME_COPY[outcome]
