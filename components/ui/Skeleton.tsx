import { cn } from "@/lib/utils/cn"

interface SkeletonProps {
  className?: string
}

/** Shimmering placeholder block; size it with `className` (e.g. `h-4 w-24`). */
export const Skeleton = ({ className }: SkeletonProps) => (
  <span className={cn("kmr-skeleton block rounded-sm", className)} aria-hidden="true" />
)
