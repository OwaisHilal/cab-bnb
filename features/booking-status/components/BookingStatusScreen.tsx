import { TopBar } from "@/components/ui/TopBar";
import { cn } from "@/lib/utils/cn";
import { isQuoteSelectionLocked } from "@/features/booking-status/quoteActions";
import type { BookingSummaryUi, QuoteRowUi } from "@/features/booking-status/types";

interface BookingStatusScreenProps {
  booking: BookingSummaryUi
  isDemoFlow?: boolean
  onSelectQuote?: (quoteId: string) => void
  onOpenMockChat?: () => void
}

export function BookingStatusScreen({
  booking,
  isDemoFlow = false,
  onSelectQuote,
  onOpenMockChat,
}: BookingStatusScreenProps) {
  const hasQuotes = booking.quotes.length > 0;
  const selectionLocked = isQuoteSelectionLocked(booking.quotes);
  const selectedQuote =
    booking.quotes.find((quote) => quote.id === booking.selectedQuoteId) ??
    booking.quotes.find((quote) => quote.isBestPrice) ??
    booking.quotes[0] ??
    null;
  const hasChosenQuote = Boolean(selectedQuote);

  return (
    <div className="flex-1 overflow-y-auto p-[30px] pb-[90px] pt-[30px] animate-kmr-fade">
      <TopBar />

      <div className="mt-4 flex flex-col gap-1">
        <span className="font-mono text-[8.5px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          BOOKING #{booking.bookingRef}
        </span>
        <h1 className="font-archivo text-[30px] font-extrabold leading-[1.1] tracking-[-0.8px] text-kmr-ink">
          {hasQuotes ? "Quotes are in." : "Quotes incoming."}
        </h1>
        <p className="font-archivo text-[13.5px] font-bold leading-[1.4] tracking-[-0.2px] text-kmr-blue">
          {booking.summaryLabel}
        </p>
      </div>

      <div className="my-3.5 flex items-center gap-1.5 font-mono text-[8.5px] font-semibold tracking-[0.8px]">
        <span className="text-kmr-blue">SENT ✓</span>
        <span className="h-[1.5px] flex-1 bg-kmr-blue" />
        <span className="flex items-center gap-1.5 text-kmr-orange">
          <span className="size-1.5 flex-none animate-kmr-pulse rounded-full bg-kmr-orange" />
          QUOTES
        </span>
        <span className={cn("h-[1.5px] flex-1", hasChosenQuote ? "bg-kmr-blue" : "bg-black/10")} />
        <span className={cn(hasChosenQuote ? "text-kmr-blue" : "text-kmr-muted-3")}>CHOOSE</span>
        <span className="h-[1.5px] flex-1 bg-black/10" />
        <span className="text-kmr-muted-3">RIDE</span>
      </div>

      {hasQuotes ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[8.5px] font-semibold tracking-[1.2px] text-kmr-muted-3">
            {selectionLocked ? "SELECTED OPERATOR" : "TAP TO CHOOSE YOUR OPERATOR"}
          </span>
          {booking.quotes.map((quote) => (
            <QuoteRow
              key={quote.id}
              quote={quote}
              selected={quote.id === selectedQuote?.id}
              disabled={selectionLocked}
              onSelect={onSelectQuote}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-sm bg-kmr-surface p-4 text-center">
          <span className="font-archivo text-[13px] font-medium text-kmr-muted-2">
            {booking.isAwaitingQuotes
              ? isDemoFlow
                ? "Demo mode is delivering your matched quotes — they appear here in a moment."
                : "Matching your trip against verified operators — quotes are on their way to WhatsApp."
              : isDemoFlow
                ? "Your demo quotes are ready below — in production these also land on WhatsApp."
                : "We couldn't load your quotes just yet. Check WhatsApp — they may already be there."}
          </span>
        </div>
      )}

      <span className="mt-2 block font-mono text-[8.5px] font-medium tracking-[1px] text-kmr-muted-3">
        {hasQuotes
          ? selectionLocked
            ? "BOOKING LOCKED TO YOUR SELECTED OPERATOR"
            : isDemoFlow
            ? "SELECT A QUOTE, THEN OPEN MOCK CHAT TO PAY \u20b999"
            : "SELECT A QUOTE — PAY \u20b999 TO LOCK ON WHATSAPP"
          : isDemoFlow
            ? "DEMO AUTO-SENDS A FAKE WHATSAPP CARD AFTER OTP VERIFY"
            : "QUOTES ARE MATCHED SERVER-SIDE — WHATSAPP DELIVERS THEM TO YOU"}
      </span>

      <div className="mt-4 flex flex-col gap-2 rounded-sm bg-kmr-green p-4">
        <span className="font-mono text-[8.5px] font-semibold tracking-[1.5px] text-white/75">
          {isDemoFlow ? "DEMO MESSAGING" : "LIVE ON WHATSAPP"}
        </span>
        <p className="font-archivo text-[15px] font-bold leading-[1.4] tracking-[-0.2px] text-white">
          {isDemoFlow
            ? selectedQuote
              ? `Continue with ${selectedQuote.vendorName} in the mock chat — pay \u20b999 to lock.`
              : "Select an operator above, then open mock chat to continue."
            : selectedQuote
              ? `Continue with ${selectedQuote.vendorName} on WhatsApp to pay \u20b999 and lock.`
              : "Select an operator above, then continue on WhatsApp."}
        </p>
        {isDemoFlow && onOpenMockChat ? (
          <button
            type="button"
            onClick={onOpenMockChat}
            disabled={!selectedQuote}
            className="self-start rounded-sm bg-white px-3.5 py-2.5 font-archivo text-xs font-bold text-kmr-green disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selectedQuote ? `Open chat · ${selectedQuote.vendorName}` : "Select a quote first"}
          </button>
        ) : (
          <span className="self-start rounded-sm bg-white/15 px-3.5 py-2.5 font-archivo text-xs font-bold text-white">
            {selectedQuote ? `Check WhatsApp for ${selectedQuote.vendorName}` : "Select a quote, then check WhatsApp"}
          </span>
        )}
      </div>
    </div>
  );
}

function QuoteRow({
  quote,
  selected,
  disabled,
  onSelect,
}: {
  quote: QuoteRowUi
  selected: boolean
  disabled: boolean
  onSelect?: (quoteId: string) => void
}) {
  const handleSelect = () => {
    if (disabled || !onSelect) return
    onSelect(quote.id)
  }

  return (
    <button
      type="button"
      onClick={handleSelect}
      disabled={disabled || !onSelect}
      aria-pressed={selected}
      aria-label={`Select ${quote.vendorName} at ${quote.priceLabel}`}
      className={cn(
        "flex w-full items-center justify-between rounded-sm border px-3.5 py-[15px] text-left transition-colors",
        selected
          ? "border-kmr-blue bg-kmr-blue/10 ring-1 ring-kmr-blue/30"
          : "border-transparent bg-kmr-surface hover:border-kmr-blue/20",
        disabled && !selected && "cursor-default opacity-70",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full border",
            selected ? "border-kmr-blue bg-kmr-blue text-white" : "border-kmr-muted-3 bg-white",
          )}
          aria-hidden
        >
          {selected && <span className="text-[10px] leading-none">✓</span>}
        </span>
        <span
          className={cn(
            "font-archivo text-[15px]",
            selected || quote.isBestPrice ? "font-extrabold text-kmr-blue" : "font-bold text-kmr-ink",
          )}
        >
          {quote.vendorName}
        </span>
        {quote.isNew && (
          <span className="rounded-sm bg-kmr-orange px-[5px] py-0.5 font-mono text-[7.5px] font-bold tracking-[1px] text-white">
            NEW
          </span>
        )}
        {quote.isBestPrice && (
          <span className="rounded-sm bg-kmr-blue/15 px-[5px] py-0.5 font-mono text-[7.5px] font-bold tracking-[1px] text-kmr-blue">
            BEST
          </span>
        )}
      </span>
      <span
        className={cn(
          "font-mono text-sm font-bold tracking-[0.5px]",
          selected || quote.isBestPrice ? "text-kmr-blue" : "text-kmr-ink",
        )}
      >
        {quote.priceLabel}
      </span>
    </button>
  );
}
