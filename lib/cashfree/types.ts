export type CashfreeLinkStatus = "PAID" | "PARTIALLY_PAID" | "CANCELLED" | "EXPIRED" | "ACTIVE" | string

export interface CashfreePaymentLinkWebhookData {
  linkId: string
  linkStatus: CashfreeLinkStatus
  cfLinkId?: number
  linkAmount?: string
  linkAmountPaid?: string
  customerPhone?: string | null
}

export interface ParsedCashfreeWebhook {
  type: string
  eventTime: string
  data: CashfreePaymentLinkWebhookData | null
}

export interface VerifyCashfreeWebhookSignatureInput {
  rawBody: string
  timestamp: string | null
  signature: string | null
  secret: string
}

// ---------------------------------------------------------------------------
// PG Orders (`POST /pg/orders`) — restores per-booking payment correlation.
// Different product from Payment Links above: not gated by
// `link_creation_api is not enabled or approved`. See
// docs/cashfree-payment-links-workaround.md.
// ---------------------------------------------------------------------------

export interface CashfreeOrderCustomerDetails {
  customerId: string
  customerPhone: string
  customerEmail?: string
  customerName?: string
}

export interface CreateCashfreeOrderInput {
  /** Merchant-assigned order id. Cashfree requires this to be unique. */
  orderId: string
  orderAmount: number
  orderCurrency?: string
  customer: CashfreeOrderCustomerDetails
  /** Cashfree substitutes the literal `{order_id}` in this URL on redirect. */
  returnUrl: string
  notifyUrl: string
}

export interface CreateCashfreeOrderResult {
  success: boolean
  /** false when CASHFREE_CLIENT_ID/CASHFREE_SECRET_KEY are not set. */
  configured: boolean
  orderId?: string
  cfOrderId?: string
  paymentSessionId?: string
  orderStatus?: string
  orderExpiryTime?: string
  error?: string
}

export type CashfreePaymentStatus =
  | "SUCCESS"
  | "FAILED"
  | "PENDING"
  | "NOT_ATTEMPTED"
  | "FLAGGED"
  | "CANCELLED"
  | "VOID"
  | "USER_DROPPED"
  | string

export interface CashfreePaymentWebhookData {
  orderId: string
  cfOrderId?: string
  orderAmount?: number
  paymentStatus: CashfreePaymentStatus
  paymentAmount?: number
  cfPaymentId?: string
  bankReference?: string | null
  paymentTime?: string
  customerPhone?: string | null
}

export interface ParsedCashfreePaymentWebhook {
  type: string
  eventTime: string
  data: CashfreePaymentWebhookData | null
}
