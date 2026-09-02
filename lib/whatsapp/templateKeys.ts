export const WHATSAPP_TEMPLATE_KEYS = {
  QUOTE_SINGLE: "quote_single_v1",
  QUOTE_MULTI: "quote_multi_v1",
  DRIVER_BALANCE: "driver_balance_v1",
  DRIVER_CONTACT: "driver_contact_v1",
  OTP: "otp_verification",
} as const

export type WhatsAppTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[keyof typeof WHATSAPP_TEMPLATE_KEYS]
