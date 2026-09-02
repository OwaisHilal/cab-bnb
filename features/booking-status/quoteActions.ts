import type { QuoteRowUi } from "@/features/booking-status/types"
import { isQuoteChoiceSelectTitle } from "@/lib/whatsapp/quoteChoiceTemplate"

export interface QuoteActionButton {
  id: string
  title: string
}

export function buildSelectedQuoteChatBody(
  quote: Pick<QuoteRowUi, "vendorName" | "priceLabel">,
): string {
  return ["Your Kashmir Cab Quote \ud83d\ude96", "", `${quote.vendorName}: ${quote.priceLabel}/day`].join("\n")
}

export function isQuoteCardMessageBody(body: string | null): boolean {
  if (!body) return false
  return (
    body.startsWith("Your Kashmir Cab Quote") ||
    body.startsWith("Your Kashmir Cab Quotes Are In") ||
    body.startsWith("Your Kashmir cab quotes are in")
  )
}

export function isQuoteActionButton(button: QuoteActionButton): boolean {
  return (
    button.id.startsWith("BOOK_FULL::") ||
    button.id.startsWith("BOOK_TOKEN::") ||
    button.id.startsWith("NEGOTIATE::")
  )
}

export function resolveQuoteCardButtons(
  buttons: QuoteActionButton[],
  options: {
    selectedQuote: Pick<QuoteRowUi, "id"> | null
    isLatestActionable: boolean
  },
): QuoteActionButton[] {
  if (buttons.some((button) => button.id.startsWith("COMPLETE_PAYMENT"))) {
    return buttons
  }

  const isQuoteChoice = buttons.filter((button) => isQuoteChoiceSelectTitle(button.title)).length >= 2
  if (isQuoteChoice) {
    return buttons.filter((button) => button.id.startsWith("BOOK_TOKEN::"))
  }

  const hasQuoteActions = buttons.some(isQuoteActionButton)
  const quoteId =
    options.selectedQuote?.id ??
    extractQuoteIdFromActionButtons(buttons)

  if (options.isLatestActionable && quoteId && hasQuoteActions) {
    return [{ id: `BOOK_TOKEN::${quoteId}`, title: "Pay \u20b999 to Lock" }]
  }

  if (!hasQuoteActions && buttons.length === 0) {
    return buttons
  }

  return buttons.filter(
    (button) => !button.id.startsWith("NEGOTIATE::") && !button.id.startsWith("BOOK_FULL::"),
  )
}

export function buildQuoteActionButtons(quote: Pick<QuoteRowUi, "id" | "vendorName" | "isBestPrice">): QuoteActionButton[] {
  return [{ id: `BOOK_TOKEN::${quote.id}`, title: "Pay \u20b999 to Lock" }]
}

export function extractQuoteIdFromActionButtons(buttons: QuoteActionButton[]): string | null {
  for (const button of buttons) {
    const [action, entityId] = button.id.split("::")
    if (!entityId) continue
    if (action === "BOOK_FULL" || action === "BOOK_TOKEN" || action === "NEGOTIATE") {
      return entityId
    }
  }
  return null
}

export function pickDefaultSelectedQuoteId(quotes: QuoteRowUi[]): string | null {
  if (quotes.length === 0) return null
  return quotes.find((quote) => quote.isBestPrice)?.id ?? quotes[0]?.id ?? null
}

export function isQuoteSelectionLocked(quotes: QuoteRowUi[]): boolean {
  return quotes.some((quote) => quote.status === "finalized")
}
