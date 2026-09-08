export const QUOTE_SEND_ELIGIBLE_STATUSES = ["quotes_ready", "otp_pending"] as const

export const SEND_QUOTES_ACTIVE_JOB_STATUSES = ["queued", "processing"] as const

export function isQuoteSendEligibleStatus(status: string): boolean {
  return (QUOTE_SEND_ELIGIBLE_STATUSES as readonly string[]).includes(status)
}

/**
 * First OTP/Phone.Email completion may enqueue send_quotes.
 * A second concurrent verify must not insert another job.
 */
export function shouldInsertSendQuotesJob(input: {
  tripStatus: string
  queuedOrProcessingCount: number
}): boolean {
  if (!isQuoteSendEligibleStatus(input.tripStatus)) return false
  return input.queuedOrProcessingCount <= 0
}
