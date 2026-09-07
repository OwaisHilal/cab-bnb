import "server-only"

import { sendMsg91TemplateMessage } from "@/lib/msg91/send"
import { isMsg91WhatsAppConfigured } from "@/lib/msg91/sendSession"
import { resolveWhatsAppTemplateEnv } from "@/lib/whatsapp/templateEnv"
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
 * so a cold-start conversation can open. Session list/button is the fallback
 * when MSG91 is missing, the template is not approved, or the spec is interactive-only.
 */
export async function sendWhatsAppMessage(
  phoneE164: string,
  spec: WhatsAppMessageSpec,
): Promise<SendWhatsAppResult> {
  if (
    spec.msg91SendMode === "template" &&
    spec.msg91Components &&
    Object.keys(spec.msg91Components).length > 0 &&
    isMsg91WhatsAppConfigured()
  ) {
    const templateEnv = resolveWhatsAppTemplateEnv(spec.templateKey)
    if (templateEnv) {
      const templateSend = await sendMsg91TemplateMessage({
        toE164: phoneE164,
        templateName: templateEnv.templateName,
        languageCode: templateEnv.languageCode,
        namespace: templateEnv.namespace,
        components: spec.msg91Components,
      })
      if (templateSend.success) return templateSend
    }
  }

  if (spec.list && spec.list.sections.some((section) => section.rows.length > 0)) {
    return sendWhatsAppListMessage(phoneE164, spec.bodyText, spec.list)
  }

  if (spec.ctaUrl?.url) {
    const ctaSend = await sendWhatsAppCtaUrlMessage(phoneE164, spec.bodyText, spec.ctaUrl, {
      footerText: spec.footerText,
    })
    if (ctaSend.success) return ctaSend
    return sendWhatsAppTextMessage(phoneE164, spec.bodyText)
  }

  if (spec.buttons.length > 0) {
    return sendWhatsAppButtonMessage(phoneE164, spec.bodyText, spec.buttons, {
      footerText: spec.footerText,
    })
  }

  const templateEnv = resolveWhatsAppTemplateEnv(spec.templateKey)
  if (
    templateEnv &&
    spec.msg91SendMode === "text" &&
    spec.msg91Components &&
    Object.keys(spec.msg91Components).length > 0
  ) {
    return sendMsg91TemplateMessage({
      toE164: phoneE164,
      templateName: templateEnv.templateName,
      languageCode: templateEnv.languageCode,
      namespace: templateEnv.namespace,
      components: spec.msg91Components,
    })
  }

  return sendWhatsAppTextMessage(phoneE164, spec.bodyText)
}
