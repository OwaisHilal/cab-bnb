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
