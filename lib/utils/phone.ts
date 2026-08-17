/**
 * The booking UI only collects a 10-digit local number with a fixed +91
 * prefix (see the phone input in features/whatsapp-otp/components/WhatsAppOtpSheet.tsx).
 * This normalizes it to the E.164 shape app/api/otp/send and
 * app/api/otp/verify require.
 */
export const INDIAN_PHONE_DIGITS = 10;

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

export function sanitizeIndianPhoneInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, INDIAN_PHONE_DIGITS);
}

export function formatIndianPhoneDisplay(digits: string): string {
  const clean = sanitizeIndianPhoneInput(digits);
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)} ${clean.slice(5)}`;
}

export function isValidIndianMobile(digits: string): boolean {
  return INDIAN_MOBILE_REGEX.test(sanitizeIndianPhoneInput(digits));
}

export function toIndianE164(localDigits: string): string {
  return `+91${sanitizeIndianPhoneInput(localDigits)}`;
}
