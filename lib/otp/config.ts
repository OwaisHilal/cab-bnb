function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Plan §14 config flags, env-overridable with the plan's documented
 * defaults. Kept centralized here rather than inlined in route handlers so
 * every OTP-related module (send route, verify route, future admin tooling)
 * shares one source of truth.
 */
export const OTP_CODE_LENGTH = 6;
export const OTP_EXPIRY_SECONDS = readIntEnv("OTP_EXPIRY_SECONDS", 300);
export const OTP_MAX_ATTEMPTS = readIntEnv("OTP_MAX_ATTEMPTS", 5);
export const OTP_RATE_LIMIT_MAX = readIntEnv("OTP_RATE_LIMIT_MAX", 3);
export const OTP_RATE_LIMIT_WINDOW_MINUTES = readIntEnv("OTP_RATE_LIMIT_WINDOW_MINUTES", 10);
