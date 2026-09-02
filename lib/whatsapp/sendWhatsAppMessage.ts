import "server-only"

import { sendMsg91TemplateMessage } from "@/lib/msg91/send"
import { resolveWhatsAppTemplateEnv } from "@/lib/whatsapp/templateEnv"
import {
  sendWhatsAppButtonMessage,
  sendWhatsAppListMessage,
  sendWhatsAppTextMessage,
} from "@/lib/whatsapp/sendOutbound"
import type { SendWhatsAppResult, WhatsAppMessageSpec } from "@/lib/whatsapp/types"

/**
 * Sends a canonical WhatsAppMessageSpec. Interactive messages (buttons with
 * dynamic payloads) always use session interactive API. Text-only specs try
 * MSG91 bulk template when namespace/name env is configured, else session text.
 */
export async function sendWhatsAppMessage(
  phoneE164: string,
  spec: WhatsAppMessageSpec,
): Promise<SendWhatsAppResult> {
  if (spec.list && spec.list.sections.some((section) => section.rows.length > 0)) {
    return sendWhatsAppListMessage(phoneE164, spec.bodyText, spec.list)
  }

  if (spec.buttons.length > 0) {
    return sendWhatsAppButtonMessage(phoneE164, spec.bodyText, spec.buttons)
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
