import { TopBar } from "@/components/ui/TopBar";
import { cn } from "@/lib/utils/cn";
import type { BookingSummaryUi } from "@/features/booking-status/types";

interface BookingStatusScreenProps {
  booking: BookingSummaryUi;
}

export function BookingStatusScreen({ booking }: BookingStatusScreenProps) {
  const hasQuotes = booking.quotes.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-[30px] pb-[90px] pt-[30px] animate-kmr-fade">
      <TopBar />

      <div className="mt-4 flex flex-col gap-1">
        <span className="font-mono text-[8.5px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          BOOKING #{booking.bookingRef}
        </span>
        <h1 className="font-archivo text-[30px] font-extrabold leading-[1.1] tracking-[-0.8px] text-kmr-ink">
          Quotes incoming.
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
        <span className="h-[1.5px] flex-1 bg-black/10" />
        <span className="text-kmr-muted-3">CHOOSE</span>
        <span className="h-[1.5px] flex-1 bg-black/10" />
        <span className="text-kmr-muted-3">RIDE</span>
      </div>

      {hasQuotes ? (
        <div className="flex flex-col gap-2">
          {booking.quotes.map((quote) => (
            <div
              key={quote.id}
              className={cn(
                "flex items-center justify-between rounded-sm px-3.5 py-[15px]",
                quote.isBestPrice ? "bg-kmr-blue/10" : "bg-kmr-surface",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-archivo text-[15px]",
                    quote.isBestPrice ? "font-extrabold text-kmr-blue" : "font-bold text-kmr-ink",
                  )}
                >
                  {quote.vendorName}
                </span>
                {quote.isNew && (
                  <span className="rounded-sm bg-kmr-orange px-[5px] py-0.5 font-mono text-[7.5px] font-bold tracking-[1px] text-white">
                    NEW
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "font-mono text-sm font-bold tracking-[0.5px]",
                  quote.isBestPrice ? "text-kmr-blue" : "text-kmr-ink",
                )}
              >
                {quote.priceLabel}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-sm bg-kmr-surface p-4 text-center">
          <span className="font-archivo text-[13px] font-medium text-kmr-muted-2">
            {booking.isAwaitingQuotes
              ? "Matching your trip against verified operators — quotes are on their way to WhatsApp."
              : "We couldn't load your quotes just yet. Check WhatsApp — they may already be there."}
          </span>
        </div>
      )}

      <span className="mt-2 block font-mono text-[8.5px] font-medium tracking-[1px] text-kmr-muted-3">
        {hasQuotes
          ? "OPENING QUOTES SHOWN — NEGOTIATE OR BOOK FROM YOUR WHATSAPP CHAT"
          : "QUOTES ARE MATCHED SERVER-SIDE — WHATSAPP DELIVERS THEM TO YOU"}
      </span>

      <div className="mt-4 flex flex-col gap-2 rounded-sm bg-kmr-green p-4">
        <span className="font-mono text-[8.5px] font-semibold tracking-[1.5px] text-white/75">
          LIVE ON WHATSAPP
        </span>
        <p className="font-archivo text-[15px] font-bold leading-[1.4] tracking-[-0.2px] text-white">
          New quotes ping your chat the moment they land. Negotiate and book
          from there.
        </p>
        <span className="self-start rounded-sm bg-white/15 px-3.5 py-2.5 font-archivo text-xs font-bold text-white">
          Check your WhatsApp chat to continue
        </span>
      </div>
    </div>
  );
}
