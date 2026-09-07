export type PaymentReportAction = "token_lock" | "balance" | "ignore"

export function resolvePaymentReportAction(
  payment: { paid: boolean; crqid: string | null },
  purpose: string | null | undefined,
  bookingId?: string | null,
): PaymentReportAction {
  if (!payment.paid) return "ignore"
  if (!payment.crqid) return "ignore"
  if (purpose === "balance") return "balance"
  if (purpose === "token_lock") return "token_lock"
  if (purpose) return "ignore"
  if (bookingId) return "balance"
  return "token_lock"
}

export function shouldEnqueuePaidFollowup(input: {
  action: PaymentReportAction
  bookingPaymentStatus?: string | null
  quoteStatus?: string | null
}): boolean {
  if (input.action === "ignore") return false
  if (input.action === "balance") return input.bookingPaymentStatus !== "fully_paid"
  return input.quoteStatus !== "finalized"
}

export function paymentLinkHeaderAttempts(headerImageUrl?: string): Array<string | undefined> {
  if (headerImageUrl) return [headerImageUrl, undefined]
  return [undefined]
}

export function shouldOpsAlertUnresolvedSender(rawMessage: string): boolean {
  return /^DRIVER:/i.test(rawMessage.trim())
}
