export const WHATSAPP_TEMPLATE_KEYS = {
  QUOTE_SINGLE: "quote_single_v1",
  QUOTE_MULTI: "quote_multi_v1",
  QUOTE_CHOICE: "quote_choice_v1",
  TOKEN_RECEIVED: "token_received_v1",
  VENDOR_ASSIGN_DRIVER: "vendor_assign_driver_v1",
  DRIVER_ASSIGNED_PAYMENT: "driver_assigned_payment_v1",
  DRIVER_BALANCE: "driver_balance_v1",
  DRIVER_CONTACT: "driver_contact_v1",
  OTP: "otp_verification",
  RIDE_GROUP_GUEST: "ride_group_guest_v1",
  RIDE_GROUP_DRIVER: "ride_group_driver_v1",
} as const

export type WhatsAppTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[keyof typeof WHATSAPP_TEMPLATE_KEYS]
