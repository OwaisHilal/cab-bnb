import { useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils/cn"

interface LaterDatePickChipProps {
  minDate: string
  value: string
  selected: boolean
  weekday: string
  primary: string
  icon?: ReactNode
  onFocus: () => void
  onBlur: () => void
  onChange: (isoDate: string) => void
}

export const LaterDatePickChip = ({
  minDate,
  value,
  selected,
  weekday,
  primary,
  icon,
  onFocus,
  onBlur,
  onChange,
}: LaterDatePickChipProps) => {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleOpenPicker = () => {
    const input = inputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    try {
      input.showPicker?.()
    } catch {
      // focus opens native UI where showPicker is unavailable or throws
    }
  }

  const handleChange = (isoDate: string) => {
    if (!isoDate.trim()) return
    onChange(isoDate)
  }

  return (
    <div className="relative shrink-0">
      <input
        ref={inputRef}
        type="date"
        min={minDate}
        value={value}
        aria-label="Choose another date"
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={handleOpenPicker}
        onChange={(event) => handleChange(event.target.value)}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      <div
        aria-hidden
        className={cn(
          "flex min-w-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-sm px-2 py-2 text-center transition-colors",
          selected ? "bg-kmr-blue/10 ring-2 ring-kmr-blue" : "bg-white ring-1 ring-black/6",
        )}
      >
        {weekday ? (
          <span className="font-mono text-[8px] font-semibold tracking-wide text-kmr-muted-2">
            {weekday}
          </span>
        ) : (
          <span className="h-[10px]" />
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
      </div>
    </div>
  )
}
