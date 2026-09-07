import type { WhatsAppButton, WhatsAppMessageSpec } from "@/lib/whatsapp/types"

export interface WhatsAppMessageLogPayload {
  templateKey: string
  buttons: WhatsAppButton[]
  list?: WhatsAppMessageSpec["list"]
  ctaUrl?: WhatsAppMessageSpec["ctaUrl"]
  media?: {
    carImageUrl: string
    driverImageUrl: string
  }
  msg91Components?: WhatsAppMessageSpec["msg91Components"]
}

function isButton(value: unknown): value is WhatsAppButton {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WhatsAppButton).id === "string" &&
    typeof (value as WhatsAppButton).title === "string"
  )
}

export function serializeWhatsAppMessageLogPayload(
  spec: WhatsAppMessageSpec,
  media?: WhatsAppMessageLogPayload["media"],
): string {
  const payload: WhatsAppMessageLogPayload = {
    templateKey: spec.templateKey,
    buttons: spec.buttons,
    msg91Components: spec.msg91Components,
  }
  if (spec.list) {
    payload.list = spec.list
  }
  if (spec.ctaUrl) {
    payload.ctaUrl = spec.ctaUrl
  }
  if (media) {
    payload.media = media
  }
  return JSON.stringify(payload)
}

export function parseWhatsAppMessageLogPayload(raw: string | null): WhatsAppMessageLogPayload {
  if (!raw) return { templateKey: "unknown", buttons: [] }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return { templateKey: "legacy", buttons: parsed.filter(isButton) }
    }
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Partial<WhatsAppMessageLogPayload> & { buttons?: unknown }
      const buttons = Array.isArray(record.buttons) ? record.buttons.filter(isButton) : []
      const media = record.media
      const ctaUrl =
        record.ctaUrl &&
        typeof record.ctaUrl.title === "string" &&
        typeof record.ctaUrl.url === "string"
          ? { title: record.ctaUrl.title, url: record.ctaUrl.url }
          : undefined
      if (
        media &&
        typeof media.carImageUrl === "string" &&
        typeof media.driverImageUrl === "string"
      ) {
      return {
        templateKey: record.templateKey ?? "unknown",
        buttons,
        media,
        list: record.list,
        ctaUrl,
        msg91Components: record.msg91Components,
      }
    }
    return {
      templateKey: record.templateKey ?? "unknown",
      buttons,
      list: record.list,
      ctaUrl,
      msg91Components: record.msg91Components,
    }
    }
  } catch {
    // Legacy payloads ignored.
  }

  return { templateKey: "unknown", buttons: [] }
}
