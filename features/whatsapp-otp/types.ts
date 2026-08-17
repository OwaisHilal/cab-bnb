export type OtpStep = "phone" | "code" | "phone_email" | "verified";

/**
 * "whatsapp"/"sms" come back from POST /api/otp/send once a channel accepts
 * delivery; "phone_email" is the provider-neutral fallback used when that
 * route reports `{ fallback: "phone_email" }` because both channels failed.
 */
export type OtpDeliveryChannel = "whatsapp" | "sms" | "phone_email";

/**
 * Mirrors the isolation boundary in features/phone-email/components/PhoneEmailAdapter.tsx:
 * this UI never assumes which Phone.Email frontend integration is configured,
 * only whether one is ("access_token" | "generated_button" | "react_client")
 * or isn't yet ("unconfigured") — see Plan §5/§7. "access_token" is the
 * implemented CLIENT_ID + popup + eapi.phone.email/getuser flow; the other
 * two configured modes remain placeholders pending their own dashboard flow.
 */
export type PhoneEmailProviderMode = "access_token" | "generated_button" | "react_client" | "unconfigured";

export interface OtpState {
  step: OtpStep;
  phone: string;
  code: string;
  deliveryChannel: OtpDeliveryChannel | null;
  phoneEmailMode: PhoneEmailProviderMode;
  isSubmitting: boolean;
  error: string | null;
}

export const OTP_CODE_LENGTH = 6;
export const INDIAN_PHONE_DIGITS = 10;
