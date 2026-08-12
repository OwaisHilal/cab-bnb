/**
 * The booking UI only collects a 10-digit local number with a fixed +91
 * prefix (see the phone input in features/whatsapp-otp/components/WhatsAppOtpSheet.tsx).
 * This normalizes it to the E.164 shape app/api/otp/send and
 * app/api/otp/verify require.
 */
export function toIndianE164(localDigits: string): string {
  return `+91${localDigits.replace(/\D/g, "")}`;
}
