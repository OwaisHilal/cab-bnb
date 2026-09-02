export interface MockChatMedia {
  carImageUrl: string
  driverImageUrl: string
}

export interface MockChatButton {
  id: string
  title: string
}

export interface MockChatPayload {
  templateKey?: string
  buttons: MockChatButton[]
  media?: MockChatMedia
}

function isButton(value: unknown): value is MockChatButton {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MockChatButton).id === "string" &&
    typeof (value as MockChatButton).title === "string"
  )
}

export function parseMockChatPayload(raw: string | null): MockChatPayload {
  if (!raw) return { buttons: [] }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return { templateKey: "legacy", buttons: parsed.filter(isButton) }
    }
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as {
        templateKey?: unknown
        buttons?: unknown
        media?: unknown
      }
      const buttons = Array.isArray(record.buttons) ? record.buttons.filter(isButton) : []
      const media = record.media as MockChatMedia | undefined
      const templateKey =
        typeof record.templateKey === "string" ? record.templateKey : undefined
      if (
        media &&
        typeof media.carImageUrl === "string" &&
        typeof media.driverImageUrl === "string"
      ) {
        return { templateKey, buttons, media }
      }
      return { templateKey, buttons }
    }
  } catch {
    // Legacy plain-text payloads are ignored.
  }

  return { buttons: [] }
}

export function serializeMockChatPayload(input: {
  templateKey?: string
  buttons?: MockChatButton[]
  media?: MockChatMedia
}): string | null {
  const buttons = input.buttons ?? []
  if (buttons.length === 0 && !input.media && !input.templateKey) return null
  return JSON.stringify({
    templateKey: input.templateKey,
    buttons,
    media: input.media,
  })
}

export const QUOTE_NEGOTIATE_FOOTER = "Prices shown are opening quotes. You can negotiate."

export function stripQuoteNegotiateFooter(body: string | null): string {
  if (!body) return ""
  return body.replace(new RegExp(`\\n?\\n?${QUOTE_NEGOTIATE_FOOTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "")
}
