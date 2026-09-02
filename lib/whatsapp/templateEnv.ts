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
    defaultName: "quote_single_v1",
  },
  quote_multi_v1: {
    nameKey: "MSG91_QUOTE_MULTI_TEMPLATE_NAME",
    namespaceKey: "MSG91_QUOTE_MULTI_TEMPLATE_NAMESPACE",
    defaultName: "quote_multi_v1",
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
