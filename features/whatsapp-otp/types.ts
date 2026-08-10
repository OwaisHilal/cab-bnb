export type OtpStep = "phone" | "code" | "verified";

export interface OtpState {
  step: OtpStep;
  phone: string;
  code: string;
  isSubmitting: boolean;
  error: string | null;
}

export const OTP_CODE_LENGTH = 6;
