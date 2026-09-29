import { cn } from "@/lib/utils/cn"

export const BOOKING_STEP_LABELS = ["Quotes", "Lock", "Driver", "Pay", "Ride"] as const

interface StepTrackerProps {
  steps?: readonly string[]
  /** Zero-based index of the step the user is on right now. */
  current: number
  className?: string
}

/**
 * Compact progress tracker so the user always knows where they are in the
 * booking and what comes next. Purely presentational.
 */
export const StepTracker = ({ steps = BOOKING_STEP_LABELS, current, className }: StepTrackerProps) => {
  const lastIndex = steps.length - 1
  const inset = 100 / (steps.length * 2)
  const fillWidth = lastIndex > 0 ? (Math.min(current, lastIndex) / lastIndex) * (100 - inset * 2) : 0

  return (
    <div className={cn("relative", className)}>
      <div
        className="absolute top-[9px] h-0.5 bg-black/10"
        style={{ left: `${inset}%`, right: `${inset}%` }}
        aria-hidden="true"
      />
      <div
        className="kmr-progress-fill absolute top-[9px] h-0.5 bg-kmr-blue"
        style={{ left: `${inset}%`, width: `${fillWidth}%` }}
        aria-hidden="true"
      />
      <ol
        aria-label="Booking progress"
        className="relative grid"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((label, index) => {
          const isComplete = index < current
          const isCurrent = index === current
          return (
            <li
              key={label}
              aria-current={isCurrent ? "step" : undefined}
              className="flex flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "kmr-step-dot flex size-5 items-center justify-center rounded-full border-2 bg-white",
                  isComplete && "border-kmr-blue bg-kmr-blue",
                  isCurrent && "border-kmr-blue shadow-[0_0_0_4px_rgba(22,49,219,0.12)]",
                  !isComplete && !isCurrent && "border-black/10",
                )}
              >
                {isComplete ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
                {isCurrent ? <span className="size-1.5 rounded-full bg-kmr-blue" /> : null}
              </span>
              <span
                className={cn(
                  "font-mono text-[8px] font-semibold uppercase tracking-[0.8px]",
                  isCurrent ? "text-kmr-blue" : isComplete ? "text-kmr-ink" : "text-kmr-muted-3",
                )}
              >
                {label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
