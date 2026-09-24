/**
 * Deno-side mirror of lib/whatsapp/vendorAssignToken.ts (Edge Functions
 * can't import Next.js modules). Same HMAC-SHA256-over-base64url-JSON
 * scheme, using Web Crypto (crypto.subtle, global in Deno) instead of
 * node:crypto — so a token signed here is verified successfully by
 * app/api/vendor/assign-driver/route.ts, which is the only place these
 * tokens are ever verified. Only signing is needed on this side: the
 * "Assign driver" web form lives entirely in Next.js.
 *
 * VENDOR_ASSIGN_SECRET must be set as an Edge Function secret with the
 * exact same value as the Next.js env var: `supabase secrets set
 * VENDOR_ASSIGN_SECRET=<value>`.
 */

const DEFAULT_APP_BASE_URL = "https://cab-bnb.vercel.app";
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000;

export function getAppBaseUrl(): string {
  const raw = Deno.env.get("NEXT_PUBLIC_APP_BASE_URL")?.trim() || DEFAULT_APP_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(input: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(input));
}

async function hmacSha256Base64Url(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export async function signVendorAssignToken(input: {
  bookingId: string;
  vendorId: string;
  ttlMs?: number;
}): Promise<string> {
  const secret = Deno.env.get("VENDOR_ASSIGN_SECRET")?.trim();
  if (!secret) {
    throw new Error("Missing VENDOR_ASSIGN_SECRET Edge Function secret.");
  }
  const payload = {
    bookingId: input.bookingId,
    vendorId: input.vendorId,
    exp: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
  };
  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await hmacSha256Base64Url(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

/**
 * Signs once and derives both the raw token (needed as the `button_1`
 * value on the now-approved vendor_assign_driver_v3 bulk template — its
 * URL button is fixed as `.../vendor/assign-driver?token={{1}}`) and the
 * full URL (session `cta_url` fallback + the web form link).
 */
export async function buildVendorAssignTokenAndUrl(
  input: { bookingId: string; vendorId: string },
): Promise<{ token: string; url: string }> {
  const token = await signVendorAssignToken(input);
  const url = `${getAppBaseUrl()}/vendor/assign-driver?token=${encodeURIComponent(token)}`;
  return { token, url };
}

export async function buildVendorAssignUrl(input: { bookingId: string; vendorId: string }): Promise<string> {
  return (await buildVendorAssignTokenAndUrl(input)).url;
}
