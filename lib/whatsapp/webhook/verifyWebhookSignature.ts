import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Plan §7.1 / Checklist 2.5: verify Meta's `X-Hub-Signature-256` HMAC
 * against `WHATSAPP_APP_SECRET` before processing, to reject spoofed
 * webhook calls. Must run against the raw request body text — never the
 * parsed/re-serialized JSON, since re-serialization can change byte layout
 * and break the signature check.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;

  const [scheme, providedHex] = signatureHeader.split("=");
  if (scheme !== "sha256" || !providedHex) return false;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = Buffer.from(providedHex, "hex");
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
