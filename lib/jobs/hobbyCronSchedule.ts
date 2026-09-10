/**
 * Hobby Vercel Cron may run at most once per day.
 * @see https://vercel.com/docs/cron-jobs/usage-and-pricing
 */
const SPECIFIC = /^\d+$/

export const isHobbySafeCronSchedule = (schedule: string): boolean => {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (!SPECIFIC.test(minute) || !SPECIFIC.test(hour)) return false
  if (dayOfMonth !== "*" && !SPECIFIC.test(dayOfMonth)) return false
  if (month !== "*" && !SPECIFIC.test(month)) return false
  if (dayOfWeek !== "*" && !SPECIFIC.test(dayOfWeek)) return false
  return true
}
