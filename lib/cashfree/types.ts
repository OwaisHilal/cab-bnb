export interface CashfreeCredentials {
  appId: string
  secretKey: string
  apiVersion?: string
}

export interface CreateCashfreePaymentLinkInput {
  /** Reused as `whatsapp_payment_intents.crqid` so both webhooks correlate on the same id. */
  linkId: string
  amountInr: number
  /** E.164, e.g. "+917889418789" — normalized to Cashfree's bare 10-digit format internally. */
  customerPhoneE164: string
  purpose: string
  /** Passed as link_meta.notify_url. Omit to skip webhook delivery for this link. */
  notifyUrl?: string
  notes?: Record<string, string>
  /** ISO 8601 with offset. Defaults to now + 24h (CASHFREE_LINK_EXPIRY_MS) if omitted. */
  expiryTime?: string
}

export interface CashfreePaymentLinkApiResult {
  configured: boolean
  success: boolean
  linkUrl?: string
  cfLinkId?: number
  /** Only populated on GET (Cashfree's create response doesn't need it — a freshly created link is always ACTIVE). */
  linkStatus?: string
  linkAmountPaid?: string
  error?: string
}

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
