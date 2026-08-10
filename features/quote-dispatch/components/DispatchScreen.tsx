import { TopBar } from "@/components/ui/TopBar";
import { cn } from "@/lib/utils/cn";
import type { DispatchVendorRow } from "@/features/quote-dispatch/types";

interface DispatchScreenProps {
  rows: DispatchVendorRow[];
  summaryLabel: string;
}

/**
 * Theatrical "checking vendors" screen (Plan §1 step 3 / §5 step 2). The rows
 * below step through visually while the real match against `vendor_rate_bands`
 * has already completed server-side — this animation never blocks on live
 * vendor replies.
 */
export function DispatchScreen({ rows, summaryLabel }: DispatchScreenProps) {
  return (
    <div className="absolute inset-0 flex flex-col gap-4 bg-white p-[30px] pb-6 pt-[30px] animate-kmr-fade">
      <TopBar />

      <h1 className="mt-2 font-archivo text-[34px] font-extrabold leading-[1.08] tracking-[-1px] text-kmr-ink">
        Matching your trip.
      </h1>
      <p className="font-archivo text-[13.5px] font-medium leading-[1.55] text-kmr-muted-1">
        We&apos;re checking your route against every verified operator&apos;s rates.
        This takes a few seconds.
      </p>

      <div className="mt-1.5 flex flex-col">
        <div className="flex gap-3">
          <div className="flex w-3 flex-none flex-col items-center pt-0.5">
            <span className="size-3 flex-none bg-kmr-orange" />
          </div>
          <div className="flex flex-1 flex-col gap-0.5 pb-1">
            <span className="font-mono text-[8.5px] font-semibold tracking-[1.5px] text-kmr-muted-3">
              REQUEST #KMR-2381
            </span>
            <span className="font-archivo text-[14.5px] font-bold leading-[1.35] tracking-[-0.2px] text-kmr-ink">
              {summaryLabel}
            </span>
          </div>
        </div>

        {rows.map((row) => {
          const isMatched = row.status === "matched";
          const isMatching = row.status === "matching";
          return (
            <div key={row.id} className="flex gap-3">
              <div className="flex w-3 flex-none flex-col items-center">
                <span
                  className={cn(
                    "h-8 w-0.5",
                    isMatched || isMatching ? "bg-kmr-blue" : "bg-black/10",
                  )}
                />
                <span
                  className={cn(
                    "box-border size-2.5 flex-none rounded-full border-2",
                    isMatched
                      ? "border-kmr-blue bg-kmr-blue"
                      : isMatching
                        ? "animate-kmr-pulse border-kmr-orange bg-white"
                        : "border-black/10 bg-white",
                  )}
                />
              </div>
              <div className="flex flex-1 items-end justify-between pb-px">
                <span
                  className={cn(
                    "font-archivo text-[13.5px]",
                    isMatched ? "font-bold text-kmr-ink" : "font-medium text-[#3C3F52]",
                  )}
                >
                  {row.name}
                </span>
                <span
                  className={cn(
                    "font-mono text-[8.5px] font-semibold tracking-[1px]",
                    isMatched
                      ? "text-kmr-green"
                      : isMatching
                        ? "text-kmr-orange"
                        : "text-kmr-muted-3",
                  )}
                >
                  {isMatched ? "MATCHED" : isMatching ? "CHECKING…" : "QUEUED"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1" />
      <span className="pb-1.5 text-center font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
        VERIFY YOUR WHATSAPP NUMBER NEXT TO RECEIVE YOUR QUOTES
      </span>
    </div>
  );
}
