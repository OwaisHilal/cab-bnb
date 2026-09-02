import { OTP_CODE_LENGTH } from "@/lib/otp/config";

/** Fixed OTP accepted when DEMO_MODE=true — never enable in production. */
export const DEMO_OTP_CODE = "123456";

if (DEMO_OTP_CODE.length !== OTP_CODE_LENGTH) {
  throw new Error(`DEMO_OTP_CODE must be ${OTP_CODE_LENGTH} digits`);
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}
