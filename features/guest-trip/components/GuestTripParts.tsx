import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/Skeleton"
import {
  AlertIcon,
  CalendarIcon,
  CarIcon,
  CheckIcon,
  ChevronRightIcon,
  InfoIcon,
  StarIcon,
  UsersIcon,
} from "@/components/ui/icons"
import type { GuestTripSnapshot } from "@/lib/guest-trip/types"
import { formatInr } from "@/lib/whatsapp/formatInr"
import { cn } from "@/lib/utils/cn"

type Quote = GuestTripSnapshot["quotes"][number]

const SUMMARY_SEPARATOR = "·"
const SUMMARY_ICONS = [CalendarIcon, UsersIcon, CarIcon] as const

/**
 * Renders the existing `tripSummary` text ("5 days · 2 pax · Sedan") as three
 * icon pills. Falls back to the raw string when the format is unexpected, so
 * the text shown to the user never changes.
 */
export const TripSummaryPills = ({ summary }: { summary: string }) => {
  const parts = summary
    .split(SUMMARY_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length !== SUMMARY_ICONS.length) {
    return <p className="font-archivo text-[13.5px] font-bold leading-[1.4] tracking-[-0.2px] text-kmr-blue">{summary}</p>
  }

  return (
    <ul aria-label={summary} className="flex flex-wrap gap-1.5">
      {parts.map((part, index) => {
        const Icon = SUMMARY_ICONS[index]
        return (
          <li
            key={part}
            className="inline-flex items-center gap-1.5 rounded-full bg-kmr-blue/10 px-2.5 py-1 font-archivo text-[12px] font-bold text-kmr-blue"
          >
            <Icon />
            {part}
          </li>
        )
      })}
    </ul>
  )
}

interface QuoteOptionProps {
  quote: Quote
  disabled: boolean
  onSelect: () => void
}

/** One tappable operator quote. Selection behavior is passed in unchanged. */
export const QuoteOption = ({ quote, disabled, onSelect }: QuoteOptionProps) => (
  <button
    type="button"
    aria-label={`Select ${quote.vendorName}`}
    disabled={disabled}
    onClick={onSelect}
    className={cn(
      "group relative flex w-full items-center gap-3 rounded-md border bg-white p-3.5 text-left shadow-kmr-card transition-all",
      "hover:border-kmr-blue/40 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kmr-blue",
      "disabled:cursor-not-allowed disabled:opacity-60",
      quote.isBestPrice ? "border-kmr-blue/30" : "border-black/5",
    )}
  >
    <span className="flex size-11 flex-none items-center justify-center rounded-full bg-kmr-blue/10 font-archivo text-[17px] font-extrabold text-kmr-blue">
      {quote.vendorName.charAt(0).toUpperCase()}
    </span>
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-2">
        <span className="truncate font-archivo text-[15px] font-extrabold text-kmr-ink">{quote.vendorName}</span>
        {quote.isBestPrice ? (
          <span className="flex-none rounded-full bg-kmr-orange px-2 py-0.5 font-mono text-[7.5px] font-bold tracking-[1px] text-white">
            BEST
          </span>
        ) : null}
      </span>
      {quote.rating !== null ? (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold tracking-[0.4px] text-kmr-muted-1">
          <StarIcon className="text-amber-400" />
          {quote.rating.toFixed(1)}
        </span>
      ) : null}
    </span>
    <span className="flex flex-none flex-col items-end">
      <span className="font-mono text-[15px] font-bold tracking-[0.2px] text-kmr-blue">
        {formatInr(quote.pricePerDay)}
      </span>
      <span className="font-mono text-[8.5px] font-semibold tracking-[1px] text-kmr-muted-2">PER DAY</span>
    </span>
    <ChevronRightIcon className="flex-none text-kmr-muted-3 transition-transform group-hover:translate-x-0.5 group-hover:text-kmr-blue" />
  </button>
)

/** Placeholder rows shown while quotes are still being matched. */
export const QuoteSkeletons = ({ count = 3 }: { count?: number }) => (
  <div className="flex flex-col gap-2" aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <div
        key={index}
        className="flex items-center gap-3 rounded-md border border-black/5 bg-white p-3.5"
        style={{ opacity: 1 - index * 0.25 }}
      >
        <Skeleton className="size-11 flex-none rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-2.5 w-12" />
        </div>
        <Skeleton className="h-4 w-16" />
      </div>
    ))}
  </div>
)

/** Full-screen placeholder while the trip snapshot loads for the first time. */
export const GuestTripSkeleton = () => (
  <div className="flex flex-col gap-4" aria-hidden="true">
    <Skeleton className="h-2.5 w-28" />
    <Skeleton className="h-8 w-56" />
    <div className="flex gap-1.5">
      <Skeleton className="h-6 w-20 rounded-full" />
      <Skeleton className="h-6 w-16 rounded-full" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
    <QuoteSkeletons count={3} />
  </div>
)

type AmountKey = "total" | "token" | "balance"

const AmountRow = ({ label, value, isDue }: { label: string; value: number; isDue: boolean }) => (
  <div
    className={cn(
      "flex items-center justify-between gap-3 rounded-sm px-3 py-2",
      isDue ? "bg-kmr-green/10" : "bg-transparent",
    )}
  >
    <span
      className={cn(
        "font-archivo text-sm",
        isDue ? "font-extrabold text-kmr-green-dark" : "font-medium text-kmr-muted-1",
      )}
    >
      {label}
    </span>
    <span
      className={cn(
        "font-mono text-sm tracking-[0.2px]",
        isDue ? "text-base font-bold text-kmr-green-dark" : "font-semibold text-kmr-ink",
      )}
    >
      {formatInr(value)}
    </span>
  </div>
)

/** Receipt-style summary for the token (lock) and balance steps. */
export const TripReceipt = ({ snapshot }: { snapshot: GuestTripSnapshot }) => {
  const dueKey: AmountKey = snapshot.step === "balance" ? "balance" : "token"

  return (
    <section
      aria-label="Trip receipt"
      className="overflow-hidden rounded-md border border-black/5 bg-white shadow-kmr-card animate-kmr-reveal"
    >
      {snapshot.operatorName ? (
        <div className="flex items-center justify-between gap-3 bg-kmr-blue px-4 py-3.5 text-white">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 flex-none items-center justify-center rounded-full bg-white/15 font-archivo text-sm font-extrabold">
              {snapshot.operatorName.charAt(0).toUpperCase()}
            </span>
            <span className="truncate font-archivo text-[15px] font-extrabold">{snapshot.operatorName}</span>
          </span>
          {snapshot.pricePerDay !== null ? (
            <span className="flex-none font-mono text-sm font-bold">{formatInr(snapshot.pricePerDay)}/day</span>
          ) : null}
        </div>
      ) : null}

      {snapshot.dayLines.length > 0 ? (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-4">
          {snapshot.dayLines.map((line) => (
            <li key={line} className="flex items-center gap-2 font-archivo text-[13px] font-medium text-kmr-ink">
              <span className="size-1.5 flex-none rounded-full bg-kmr-orange" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mx-4 border-t border-dashed border-black/15" />

      <div className="flex flex-col gap-0.5 p-2.5">
        {snapshot.totalAmount !== null ? (
          <AmountRow label="Total" value={snapshot.totalAmount} isDue={false} />
        ) : null}
        {snapshot.tokenAmount !== null ? (
          <AmountRow label="Token" value={snapshot.tokenAmount} isDue={dueKey === "token"} />
        ) : null}
        {snapshot.balanceAmount !== null ? (
          <AmountRow label="Balance" value={snapshot.balanceAmount} isDue={dueKey === "balance"} />
        ) : null}
      </div>
    </section>
  )
}

interface DriverCardProps {
  driverName: string | null
  driverPhone: string | null
  vehicleLabel: string | null
  vehicleNumber: string | null
  operatorName: string | null
}

/** Confirmed-driver card with a success header. */
export const DriverCard = ({ driverName, driverPhone, vehicleLabel, vehicleNumber, operatorName }: DriverCardProps) => (
  <section
    aria-label="Your driver"
    className="overflow-hidden rounded-md border border-black/5 bg-white shadow-kmr-card animate-kmr-reveal"
  >
    <div className="flex items-center gap-2.5 bg-kmr-green/10 px-4 py-3">
      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-kmr-green text-white animate-kmr-pop">
        <CheckIcon size={15} />
      </span>
      <span className="font-mono text-[9px] font-semibold tracking-[1.2px] text-kmr-green-dark">PAYMENT RECEIVED</span>
    </div>
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-12 flex-none items-center justify-center rounded-full bg-kmr-blue/10 font-archivo text-lg font-extrabold text-kmr-blue">
          {(driverName ?? "D").charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          {driverName ? (
            <p className="truncate font-archivo text-[17px] font-extrabold text-kmr-ink">{driverName}</p>
          ) : null}
          {driverPhone ? <p className="font-mono text-[13px] font-semibold text-kmr-muted-1">{driverPhone}</p> : null}
        </div>
      </div>
      {vehicleLabel || vehicleNumber ? (
        <div className="flex flex-wrap items-center gap-2">
          {vehicleLabel ? (
            <span className="inline-flex items-center gap-1.5 font-archivo text-sm font-medium text-kmr-ink">
              <CarIcon size={16} className="text-kmr-blue" />
              {vehicleLabel}
            </span>
          ) : null}
          {vehicleNumber ? (
            <span className="rounded-sm border-2 border-kmr-ink px-2 py-0.5 font-mono text-[12px] font-bold tracking-[1.5px] text-kmr-ink">
              {vehicleNumber}
            </span>
          ) : null}
        </div>
      ) : null}
      {operatorName ? <p className="font-archivo text-sm font-medium text-kmr-muted-1">{operatorName}</p> : null}
    </div>
  </section>
)

interface InlineAlertProps {
  tone: "error" | "info"
  children: ReactNode
}

/** Compact message card used for errors and notices. */
export const InlineAlert = ({ tone, children }: InlineAlertProps) => {
  const isError = tone === "error"
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3.5 py-3 font-archivo text-[13px] font-semibold leading-[1.45] animate-kmr-fade",
        isError ? "border-kmr-orange/25 bg-kmr-orange/10 text-kmr-ink" : "border-kmr-blue/15 bg-kmr-blue/10 text-kmr-ink",
      )}
    >
      <span className={cn("mt-px flex-none", isError ? "text-kmr-orange" : "text-kmr-blue")}>
        {isError ? <AlertIcon size={16} /> : <InfoIcon size={16} />}
      </span>
      <span>{children}</span>
    </div>
  )
}
