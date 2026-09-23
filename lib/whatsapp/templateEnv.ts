import "server-only"

import type { WhatsAppTemplateKey } from "@/lib/whatsapp/templateKeys"

export interface ResolvedWhatsAppTemplateEnv {
  templateName: string
  namespace?: string
  languageCode: string
}

const DEFAULT_LANGUAGE = "en_US"

const TEMPLATE_ENV_MAP: Record<
  WhatsAppTemplateKey,
  { nameKey: string; namespaceKey: string; defaultName: string }
> = {
  otp_verification: {
    nameKey: "MSG91_OTP_TEMPLATE_NAME",
    namespaceKey: "MSG91_OTP_TEMPLATE_NAMESPACE",
    defaultName: "otp_verification",
  },
  quote_single_v1: {
    nameKey: "MSG91_QUOTE_SINGLE_TEMPLATE_NAME",
    namespaceKey: "MSG91_QUOTE_SINGLE_TEMPLATE_NAMESPACE",
    defaultName: "quote_single_v2",
  },
  quote_multi_v1: {
    nameKey: "MSG91_QUOTE_MULTI_TEMPLATE_NAME",
    namespaceKey: "MSG91_QUOTE_MULTI_TEMPLATE_NAMESPACE",
    defaultName: "quote_multi_v1",
  },
  quote_choice_v1: {
    nameKey: "MSG91_QUOTE_CHOICE_TEMPLATE_NAME",
    namespaceKey: "MSG91_QUOTE_CHOICE_TEMPLATE_NAMESPACE",
    defaultName: "quote_choice_v2",
  },
  token_received_v1: {
    nameKey: "MSG91_TOKEN_RECEIVED_TEMPLATE_NAME",
    namespaceKey: "MSG91_TOKEN_RECEIVED_TEMPLATE_NAMESPACE",
    defaultName: "token_received_v1",
  },
  vendor_assign_driver_v1: {
    // Live vendor-assign path. Do not point these env vars at vendor_booking_notify_*.
    // MSG91 name is vendor_assign_driver_v2 (approved 2026-09-23, one URL
    // button — see docs/2026-09-21-vendor-assign-driver-v2-template.md).
    // Internal template_key stays v1 (same pattern as quote_choice_v1 ->
    // MSG91 quote_choice_v2).
    nameKey: "MSG91_VENDOR_NOTIFY_TEMPLATE_NAME",
    namespaceKey: "MSG91_VENDOR_NOTIFY_TEMPLATE_NAMESPACE",
    defaultName: "vendor_assign_driver_v2",
  },
  driver_assigned_payment_v1: {
    nameKey: "MSG91_DRIVER_ASSIGNED_PAYMENT_TEMPLATE_NAME",
    namespaceKey: "MSG91_DRIVER_ASSIGNED_PAYMENT_TEMPLATE_NAMESPACE",
    defaultName: "driver_assigned_payment_v1",
  },
  driver_balance_v1: {
    nameKey: "MSG91_DRIVER_BALANCE_TEMPLATE_NAME",
    namespaceKey: "MSG91_DRIVER_BALANCE_TEMPLATE_NAMESPACE",
    defaultName: "driver_balance_v1",
  },
  driver_contact_v1: {
    nameKey: "MSG91_DRIVER_CONTACT_TEMPLATE_NAME",
    namespaceKey: "MSG91_DRIVER_CONTACT_TEMPLATE_NAMESPACE",
    defaultName: "driver_contact_v1",
  },
  ride_group_guest_v1: {
    nameKey: "MSG91_RIDE_GROUP_GUEST_TEMPLATE_NAME",
    namespaceKey: "MSG91_RIDE_GROUP_GUEST_TEMPLATE_NAMESPACE",
    defaultName: "ride_group_guest_v1",
  },
  ride_group_driver_v1: {
    nameKey: "MSG91_RIDE_GROUP_DRIVER_TEMPLATE_NAME",
    namespaceKey: "MSG91_RIDE_GROUP_DRIVER_TEMPLATE_NAMESPACE",
    defaultName: "ride_group_driver_v1",
  },
}

export function resolveWhatsAppTemplateEnv(
  templateKey: WhatsAppTemplateKey,
): ResolvedWhatsAppTemplateEnv | null {
  const mapping = TEMPLATE_ENV_MAP[templateKey]
  if (!mapping) return null

  const templateName =
    process.env[mapping.nameKey as keyof NodeJS.ProcessEnv]?.trim() || mapping.defaultName
  const namespace = process.env[mapping.namespaceKey as keyof NodeJS.ProcessEnv]?.trim()
  const languageCode = process.env.MSG91_OTP_TEMPLATE_LANGUAGE?.trim() || DEFAULT_LANGUAGE

  if (!templateName) return null

  return namespace ? { templateName, namespace, languageCode } : { templateName, languageCode }
}
