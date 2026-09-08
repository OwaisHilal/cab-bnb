/**
 * Gates MSG91 Utility bulk template sends vs 24h session APIs.
 * Unset defaults to true so production does not silently drop approved templates.
 * SMS OTP and session payment_link are not gated by this flag.
 */
export function shouldUseMsg91ApprovedTemplates(
  raw: string | undefined = process.env.MSG91_USE_APPROVED_TEMPLATES,
): boolean {
  const value = raw?.trim().toLowerCase()
  if (!value) return true
  if (value === "false" || value === "no" || value === "0" || value === "off") return false
  return true
}
