import type { WhatsAppMessageSpec } from "@/lib/whatsapp/types"

export type WhatsAppSendPath = "bulk_template" | "list" | "cta" | "buttons" | "session_text"

export function resolveWhatsAppSendPath(
  spec: WhatsAppMessageSpec,
  options: {
    useApprovedTemplates: boolean
    msg91Configured: boolean
    hasTemplateEnv: boolean
  },
): WhatsAppSendPath {
  const canBulk =
    options.useApprovedTemplates &&
    options.msg91Configured &&
    options.hasTemplateEnv &&
    Boolean(spec.msg91Components && Object.keys(spec.msg91Components).length > 0)

  if (spec.msg91SendMode === "template" && canBulk) {
    return "bulk_template"
  }

  if (spec.list && spec.list.sections.some((section) => section.rows.length > 0)) {
    return "list"
  }

  if (spec.ctaUrl?.url) {
    return "cta"
  }

  if (spec.buttons.length > 0) {
    return "buttons"
  }

  if (spec.msg91SendMode === "text" && canBulk) {
    return "bulk_template"
  }

  return "session_text"
}
