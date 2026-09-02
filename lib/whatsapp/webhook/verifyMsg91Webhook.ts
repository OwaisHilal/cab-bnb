import { timingSafeEqual } from "node:crypto";

/** Header MSG91 should send — add it under Webhook (New) → Headers. */
export const MSG91_WEBHOOK_SECRET_HEADER = "x-msg91-webhook-secret";

export function getMsg91WebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.MSG91_WEBHOOK_SECRET?.trim() ?? "";
  return secret.length > 0 ? secret : null;
}

export function readMsg91WebhookSecretHeader(headers: Headers): string | null {
  const dedicated = headers.get(MSG91_WEBHOOK_SECRET_HEADER)?.trim();
  if (dedicated) {
    return dedicated;
  }

  const authorization = headers.get("authorization")?.trim() ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice("bearer ".length).trim();
    return token.length > 0 ? token : null;
  }

  return null;
}

/**
 * MSG91 Webhook (New) has no Meta HMAC. Auth is a custom header you attach
 * in the dashboard (key/value pairs forwarded on every POST).
 */
export function verifyMsg91WebhookSecret(provided: string | null, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
