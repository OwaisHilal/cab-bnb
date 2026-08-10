import { randomInt } from "node:crypto";
import { OTP_CODE_LENGTH } from "./config";

/**
 * Cryptographically random numeric OTP code (Checklist 2.3: 6-digit code).
 * Uses crypto.randomInt (CSPRNG) rather than Math.random, since this value
 * gates WhatsApp/SMS delivery and is the sole verification secret.
 */
export function generateOtpCode(): string {
  const max = 10 ** OTP_CODE_LENGTH;
  const value = randomInt(0, max);
  return value.toString().padStart(OTP_CODE_LENGTH, "0");
}
