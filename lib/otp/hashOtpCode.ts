import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/**
 * Plan §11: "Store OTP as a salted hash, not plaintext." Uses Node's
 * built-in scrypt (no bcrypt/argon2 dependency — avoids native-module build
 * issues on Windows dev machines) with a random per-code salt, stored as
 * `saltHex:hashHex` in `otp_verifications.otp_code_hash`.
 */
export async function hashOtpCode(code: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = (await scryptAsync(code, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyOtpCode(code: string, storedHash: string): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scryptAsync(code, salt, expected.length)) as Buffer;

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
