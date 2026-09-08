import "server-only"

import { sendMsg91TemplateMessage } from "@/lib/msg91/send"
import { isMsg91WhatsAppConfigured } from "@/lib/msg91/sendSession"
import { shouldUseMsg91ApprovedTemplates } from "@/lib/msg91/useApprovedTemplates"
import { resolveWhatsAppTemplateEnv } from "@/lib/whatsapp/templateEnv"
import { resolveWhatsAppSendPath, type WhatsAppSendPath } from "@/lib/whatsapp/resolveWhatsAppSendPath"
import {
  sendWhatsAppButtonMessage,
  sendWhatsAppCtaUrlMessage,
  sendWhatsAppListMessage,
  sendWhatsAppTextMessage,
} from "@/lib/whatsapp/sendOutbound"
import type { SendWhatsAppResult, WhatsAppMessageSpec } from "@/lib/whatsapp/types"

/**
 * Sends a canonical WhatsAppMessageSpec.
 * Utility templates (`msg91SendMode: "template"`) go through MSG91 bulk first
 * when MSG91_USE_APPROVED_TEMPLATES is on, so a cold-start conversation can open.
 * Session list/button/text is used when the flag is off, MSG91 is missing,
 * the template is not approved, or the spec is interactive-only.
 * SMS OTP and session payment_link are not gated here.
 */
export async function sendWhatsAppMessage(
  phoneE164: string,
  spec: WhatsAppMessageSpec,
): Promise<SendWhatsAppResult> {
  const templateEnv = resolveWhatsAppTemplateEnv(spec.templateKey)
  const pathOptions = {
    useApprovedTemplates: shouldUseMsg91ApprovedTemplates(),
    msg91Configured: isMsg91WhatsAppConfigured(),
    hasTemplateEnv: Boolean(templateEnv),
  }

  const firstPath = resolveWhatsAppSendPath(spec, pathOptions)
  if (firstPath === "bulk_template" && templateEnv && spec.msg91Components) {
    const templateSend = await sendMsg91TemplateMessage({
      toE164: phoneE164,
      templateName: templateEnv.templateName,
      languageCode: templateEnv.languageCode,
      namespace: templateEnv.namespace,
      components: spec.msg91Components,
    })
    if (templateSend.success) {
      console.info("[whatsapp send]", { mode: "template", templateKey: spec.templateKey })
      return templateSend
    }
  }

  const sessionPath = resolveWhatsAppSendPath(spec, {
    ...pathOptions,
    useApprovedTemplates: false,
  })
  const sessionSend = await sendWhatsAppSessionPath(phoneE164, spec, sessionPath)
  console.info("[whatsapp send]", { mode: "session", templateKey: spec.templateKey })
  return sessionSend
}

const sendWhatsAppSessionPath = async (
  phoneE164: string,
  spec: WhatsAppMessageSpec,
  path: WhatsAppSendPath,
): Promise<SendWhatsAppResult> => {
  if (path === "list" && spec.list) {
    return sendWhatsAppListMessage(phoneE164, spec.bodyText, spec.list)
  }

  if (path === "cta" && spec.ctaUrl?.url) {
    const ctaSend = await sendWhatsAppCtaUrlMessage(phoneE164, spec.bodyText, spec.ctaUrl, {
      footerText: spec.footerText,
    })
    if (ctaSend.success) return ctaSend
    return sendWhatsAppTextMessage(phoneE164, spec.bodyText)
  }

  if (path === "buttons") {
    return sendWhatsAppButtonMessage(phoneE164, spec.bodyText, spec.buttons, {
      footerText: spec.footerText,
    })
  }

  return sendWhatsAppTextMessage(phoneE164, spec.bodyText)
}
