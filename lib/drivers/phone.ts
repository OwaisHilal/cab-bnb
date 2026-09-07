export const phoneLast10 = (phone: string): string => {
  return phone.replace(/\D/g, "").slice(-10)
}

export const toDriverPhoneE164 = (phone: string): string => {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `+91${digits}`
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`
  if (phone.trim().startsWith("+")) return phone.trim()
  return digits ? `+${digits}` : phone.trim()
}

/** True when the entire message (not embedded digits) is a phone number. */
export const parseWholeBodyPhone = (text: string): string | null => {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (!/^\+?[\d\s\-()]{10,20}$/.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 10 || digits.length > 13) return null
  return digits
}
