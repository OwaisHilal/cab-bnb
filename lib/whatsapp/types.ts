import type { WhatsAppTemplateKey } from "@/lib/whatsapp/templateKeys"

export interface WhatsAppButton {
  id: string
  title: string
}

export interface WhatsAppListRow {
  id: string
  title: string
  description?: string
}

export interface WhatsAppListSection {
  title: string
  rows: WhatsAppListRow[]
}

export interface WhatsAppListMessage {
  buttonText: string
  sections: WhatsAppListSection[]
}

export interface WhatsAppMessageMediaMeta {
  driverName: string
  vehicleModel: string
  vehicleNumber: string
}

export type WhatsAppMsg91SendMode = "interactive" | "template" | "text"

export interface WhatsAppMessageSpec {
  templateKey: WhatsAppTemplateKey
  bodyText: string
  buttons: WhatsAppButton[]
  /** Static template / session footer (MSG91/Meta max 60 chars). */
  footerText?: string
  /** Interactive list (e.g. pick operator + Pay ₹99). Mutually exclusive with buttons. */
  list?: WhatsAppListMessage
  msg91Components?: Record<string, { type: string; value: string; subtype?: string }>
  msg91SendMode: WhatsAppMsg91SendMode
  /** Demo-only driver/car card metadata (not sent on real WhatsApp). */
  mediaMeta?: WhatsAppMessageMediaMeta
}

export interface SendWhatsAppResult {
  configured: boolean
  success: boolean
  simulated?: boolean
  waMessageId?: string
  error?: string
}

export interface QuoteDeliveryPayload {
  tripRequestId: string
  touristPhone: string
  message: WhatsAppMessageSpec
  snapshotIds: string[]
  bestQuoteSnapshotId: string
}
