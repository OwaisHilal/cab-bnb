import type { ReactNode } from "react"
import { cn } from "@/lib/utils/cn"

interface DatePickChipProps {
  selected: boolean
  onClick: () => void
  weekday: string
  primary: string
  icon?: ReactNode
  ariaLabel?: string
}

export const DatePickChip = ({
  selected,
  onClick,
  weekday,
  primary,
  icon,
  ariaLabel,
}: DatePickChipProps) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className={cn(
      "flex min-w-[4.25rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm px-2 py-2 text-center transition-colors",
      selected ? "bg-kmr-blue/10 ring-2 ring-kmr-blue" : "bg-white ring-1 ring-black/6",
    )}
  >
    {weekday ? (
      <span className="font-mono text-[8px] font-semibold tracking-wide text-kmr-muted-2">
        {weekday}
      </span>
    ) : (
      <span className="h-[10px]" aria-hidden />
    )}
    <span
      className={cn(
        "flex items-center gap-0.5 font-archivo text-[13px] font-bold leading-tight",
        selected ? "text-kmr-blue" : "text-kmr-ink",
      )}
    >
      {icon}
      {primary}
    </span>
  </button>
)
