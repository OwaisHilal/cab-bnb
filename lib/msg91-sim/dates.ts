const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseYmd(value: string): Date | null {
  const match = YMD.exec(value.trim())
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export type DateWindowOk = { ok: true; start: Date; end: Date }
export type DateWindowErr = { ok: false; message: string }

export function validateLogWindow(
  startDate: string,
  endDate: string,
  now = new Date(),
): DateWindowOk | DateWindowErr {
  const start = parseYmd(startDate)
  const end = parseYmd(endDate)
  if (!start || !end) {
    return { ok: false, message: "startDate and endDate must be YYYY-MM-DD" }
  }
  if (end < start) {
    return { ok: false, message: "endDate must be on or after startDate" }
  }
  const today = utcDayStart(now)
  const earliest = addUtcDays(today, -2)
  if (start < earliest) {
    return { ok: false, message: "Start Date must be within the last 3 days (YYYY-MM-DD)" }
  }
  const spanDays = (end.getTime() - start.getTime()) / 86400000
  if (spanDays > 2) {
    return { ok: false, message: "Range for Start Date and End Date is 3 days (YYYY-MM-DD)" }
  }
  if (end > today) {
    return { ok: false, message: "endDate cannot be in the future" }
  }
  return { ok: true, start, end: addUtcDays(end, 1) }
}

export function validateAnalyticsWindow(
  startDate: string | undefined,
  endDate: string | undefined,
  now = new Date(),
): DateWindowOk | DateWindowErr {
  const today = utcDayStart(now)
  const defaultStart = addUtcDays(today, -30)
  const start = startDate ? parseYmd(startDate) : defaultStart
  const end = endDate ? parseYmd(endDate) : today
  if (!start || !end) {
    return { ok: false, message: "startDate and endDate must be YYYY-MM-DD" }
  }
  if (end < start) {
    return { ok: false, message: "endDate must be on or after startDate" }
  }
  const spanDays = (end.getTime() - start.getTime()) / 86400000
  if (spanDays > 30) {
    return { ok: false, message: "Maximum duration supported - Last 31 days" }
  }
  return { ok: true, start, end: addUtcDays(end, 1) }
}
