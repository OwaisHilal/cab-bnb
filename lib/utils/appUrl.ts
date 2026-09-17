const DEFAULT_APP_BASE_URL = "https://cab-bnb.vercel.app"

/**
 * Base URL for links this app generates itself — the WhatsApp CTA payment
 * page (`/pay/token/<crqid>`) and the Cashfree PG Order `return_url` /
 * `order_meta.notify_url`. Defaults to the fixed production domain the
 * Cashfree dashboard webhook is already pointed at
 * (https://cab-bnb.vercel.app/webhooks/cashfree) — override with
 * NEXT_PUBLIC_APP_BASE_URL for sandbox/staging/local-tunnel testing.
 */
export function getAppBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || DEFAULT_APP_BASE_URL
  return raw.replace(/\/+$/, "")
}
