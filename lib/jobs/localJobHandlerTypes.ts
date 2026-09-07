/** Job types the Next.js `processDueJobs` fallback can claim and run. */
export const SEND_QUOTES_JOB_TYPE = "send_quotes"

export const LOCAL_JOB_HANDLER_TYPES = [
  SEND_QUOTES_JOB_TYPE,
  "send_token_payment_link",
  "finalize_booking",
  "send_token_received_ack",
  "notify_vendor_booking",
  "parse_driver_details",
  "send_balance_payment",
  "complete_balance_payment",
  "create_ride_group",
  "remind_ride_group_join",
  "delete_ride_group",
] as const

export type LocalJobHandlerType = (typeof LOCAL_JOB_HANDLER_TYPES)[number]
