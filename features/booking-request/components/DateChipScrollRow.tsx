"use client"

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils/cn"

interface DateChipScrollRowProps {
  children: ReactNode
}

export const DateChipScrollRow = ({ children }: DateChipScrollRowProps) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [canScrollStart, setCanScrollStart] = useState(false)
  const [canScrollEnd, setCanScrollEnd] = useState(false)
  const [hasUserScrolled, setHasUserScrolled] = useState(false)

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current
    if (!element) return

    const overflow = element.scrollWidth > element.clientWidth + 1
    setHasOverflow(overflow)
    setCanScrollStart(element.scrollLeft > 0)
    setCanScrollEnd(element.scrollLeft + element.clientWidth < element.scrollWidth - 1)
  }, [])

  useLayoutEffect(() => {
    updateScrollState()
    const element = scrollRef.current
    if (!element) return

    const resizeObserver = new ResizeObserver(() => updateScrollState())
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [updateScrollState, children])

  const handleScroll = () => {
    const element = scrollRef.current
    if (element && element.scrollLeft > 0) {
      setHasUserScrolled(true)
    }
    updateScrollState()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="relative min-h-0 min-w-0 flex-1">
        {hasOverflow && canScrollStart && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-white to-transparent"
            aria-hidden
          />
        )}
        {hasOverflow && canScrollEnd && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-white to-transparent"
            aria-hidden
          />
        )}
        <div
          ref={scrollRef}
          role="group"
          aria-label="Upcoming departure dates"
          onScroll={handleScroll}
          className={cn(
            "kmr-scrollbar-none -mx-1 overflow-x-auto overscroll-x-contain px-1",
            "scroll-snap-x scroll-snap-mandatory",
          )}
        >
          <div className="flex w-max flex-nowrap gap-2 pr-3">{children}</div>
        </div>
      </div>
      {hasOverflow && !hasUserScrolled && (
        <p className="font-mono text-[8px] font-medium tracking-wide text-kmr-muted-3" aria-hidden>
          Swipe for more dates
        </p>
      )}
    </div>
  )
}
