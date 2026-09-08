import { parseSelectVendorTapText } from "@/lib/whatsapp/webhook/resolveSelectVendorTap"

export function fillSimulatedButtonPayload(input: {
  buttonPayload?: string | null
  buttonText?: string | null
  resolvedQuoteSnapshotId?: string | null
}): { payload: string | null; text: string | null; filledFromTitle: boolean } {
  const explicit = input.buttonPayload?.trim() || null
  const text = input.buttonText?.trim() || explicit
  if (explicit) {
    return { payload: explicit, text: text ?? explicit, filledFromTitle: false }
  }

  const title = parseSelectVendorTapText(text)
  const snapshotId = input.resolvedQuoteSnapshotId?.trim() || null
  if (title && snapshotId) {
    return {
      payload: `BOOK_TOKEN::${snapshotId}`,
      text: title,
      filledFromTitle: true,
    }
  }

  return { payload: null, text: text ?? null, filledFromTitle: false }
}
