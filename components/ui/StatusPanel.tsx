import type { ReactNode } from "react"
import { Spinner } from "@/components/ui/Spinner"
import { cn } from "@/lib/utils/cn"

type StatusTone = "blue" | "orange" | "green"

interface StatusPanelProps {
  icon: ReactNode
  title: string
  description?: string
  /** Shows a spinner chip so the user knows the page is still working. */
  liveLabel?: string
  /** Adds soft expanding rings behind the icon for "in progress" states. */
  pulse?: boolean
  tone?: StatusTone
  className?: string
}

const ICON_TONE_CLASSES: Record<StatusTone, string> = {
  blue: "bg-kmr-blue/10 text-kmr-blue",
  orange: "bg-kmr-orange/10 text-kmr-orange",
  green: "bg-kmr-green/10 text-kmr-green-dark",
}

const PULSE_TONE_CLASSES: Record<StatusTone, string> = {
  blue: "bg-kmr-blue/20",
  orange: "bg-kmr-orange/20",
  green: "bg-kmr-green/20",
}

/**
 * Centered card for "something is happening, please wait" and result states.
 * Announced politely to assistive tech via role="status".
 */
export const StatusPanel = ({
  icon,
  title,
  description,
  liveLabel,
  pulse = false,
  tone = "blue",
  className,
}: StatusPanelProps) => (
  <div
    role="status"
    aria-live="polite"
    className={cn(
      "flex flex-col items-center gap-3 rounded-md border border-black/5 bg-white p-5 text-center shadow-kmr-card animate-kmr-reveal",
      className,
    )}
  >
    <span className="relative flex size-14 items-center justify-center">
      {pulse ? (
        <span
          className={cn("absolute inset-0 animate-ping rounded-full motion-reduce:hidden", PULSE_TONE_CLASSES[tone])}
          aria-hidden="true"
        />
      ) : null}
      <span className={cn("relative flex size-14 items-center justify-center rounded-full", ICON_TONE_CLASSES[tone])}>
        {icon}
      </span>
    </span>
    <h2 className="font-archivo text-[19px] font-extrabold leading-[1.2] tracking-[-0.4px] text-kmr-ink">{title}</h2>
    {description ? (
      <p className="font-archivo text-[13px] font-medium leading-[1.55] text-kmr-muted-1">{description}</p>
    ) : null}
    {liveLabel ? (
      <span className="inline-flex items-center gap-2 rounded-full bg-kmr-surface px-3 py-1.5 font-mono text-[9px] font-semibold tracking-[0.8px] text-kmr-muted-1">
        <Spinner size="sm" tone="blue" />
        {liveLabel}
      </span>
    ) : null}
  </div>
)
