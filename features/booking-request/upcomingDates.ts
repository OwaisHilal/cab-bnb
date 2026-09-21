import type { DateOption } from "./types"

// Fixed lookup tables instead of Date#toLocaleDateString: Intl output for
// weekday/month abbreviations varies by ICU data (e.g. "Sept" vs "Aug")
// across Node versions and browsers, which would make both the UI label
// and any test asserting it flaky. Deterministic string building matches
// the "no UTC shift" local-calendar-math convention already used for trip
// day labels (lib/whatsapp/tokenPaymentLink.ts).
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

const toIsoDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const formatShortDateLabel = (date: Date): string =>
  `${WEEKDAY_LABELS[date.getDay()]} ${date.getDate()} ${MONTH_LABELS[date.getMonth()]}`

/**
 * Builds `count` quick-pick date chips for consecutive local calendar days
 * starting from `now`'s date (defaults to today). Always driven by Date's
 * local getters/constructor — never UTC — so the chip shown to a guest in
 * IST always matches their own "today", and so a booking made late at
 * night doesn't silently offer yesterday.
 */
export function getUpcomingDates(now: Date = new Date(), count = 4): DateOption[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index)
    return {
      id: `d${index + 1}`,
      shortLabel: formatShortDateLabel(date),
      isoDate: toIsoDate(date),
    }
  })
}
