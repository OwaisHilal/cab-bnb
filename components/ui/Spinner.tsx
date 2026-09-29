import { cn } from "@/lib/utils/cn"

type SpinnerTone = "white" | "blue" | "ink"
type SpinnerSize = "sm" | "md" | "lg"

interface SpinnerProps {
  tone?: SpinnerTone
  size?: SpinnerSize
  className?: string
}

const TONE_CLASSES: Record<SpinnerTone, string> = {
  white: "border-white/30 border-t-white",
  blue: "border-kmr-blue/20 border-t-kmr-blue",
  ink: "border-kmr-ink/15 border-t-kmr-ink",
}

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "size-3.5 border-2",
  md: "size-4 border-2",
  lg: "size-6 border-[3px]",
}

/**
 * Decorative spinner. Always pair it with visible text (or a role="status"
 * region) so screen readers get the same "please wait" message.
 */
export const Spinner = ({ tone = "white", size = "md", className }: SpinnerProps) => (
  <span
    className={cn("flex-none animate-spin rounded-full", SIZE_CLASSES[size], TONE_CLASSES[tone], className)}
    aria-hidden="true"
  />
)
