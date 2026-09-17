# ₹99 Token Payment: Cashfree PG Orders Integration — What We Did and Why

Companion to [`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md) and
[`2026-09-14-static-cashfree-link-rollback.md`](./2026-09-14-static-cashfree-link-rollback.md),
which explain the temporary static-link workaround this change replaces.

## TL;DR

- The static Cashfree Payment Link workaround (Sep 14 2026) fixed "nothing on WhatsApp" but gave
  up automated per-booking payment confirmation — every payment shared one Cashfree `link_id`, so
  a webhook event couldn't be trusted to belong to one specific booking.
- Cashfree's **PG Orders API** (`POST /pg/orders`) is a different product from Payment Links. It
  is not gated by the `link_creation_api is not enabled or approved` block that forced the
  static-link fallback, so we're back to one Cashfree order per booking with its own
  `payment_session_id`.
- Each WhatsApp "Pay 99" button now links to our own app-hosted page
  (`/pay/token/<crqid>`) instead of a Cashfree URL directly. That page opens Cashfree's hosted
  Checkout for that specific order.
- `app/webhooks/cashfree` — the path already configured on the Cashfree dashboard
  (`https://cab-bnb.vercel.app/webhooks/cashfree`) — verifies the signed
  `PAYMENT_SUCCESS_WEBHOOK`, matches `cf_order_id` back to a `whatsapp_payment_intents` row, and
  calls the existing `confirmPaymentByCrqid` to finalize the booking automatically, the same way
  MSG91's "On Payment Report Received" already does for balance payments.
- `app/api/cashfree/webhook` (the old path) is kept as a thin compatibility alias that delegates
  to the same handler.

## Why PG Orders instead of retrying Payment Links

Two Cashfree integration paths were already confirmed blocked on this merchant account:

1. MSG91's session `payment_link` interactive type (`s2s_enabled_not_approved`).
2. Cashfree's own dynamic Payment Links create-API, `POST /pg/links`
   (`link_creation_api is not enabled or approved`).

**PG Orders (`POST /pg/orders`) is a separate Cashfree product** that powers Cashfree's own
hosted Checkout (`payment_session_id` + `@cashfreepayments/cashfree-js`), not the Payment Links
product. Neither block above applies to it. This is confirmed by Cashfree's own docs describing
Orders and Payment Links as different API surfaces with different feature flags — it's not a
guess that happens to work around the same restriction.

## Architecture

```mermaid
flowchart LR
  tourist["Tourist taps Select Vendor"] --> whatsappWebhook["WhatsApp webhook"]
  whatsappWebhook --> jobQueue["job_queue: send_token_payment_link"]
  jobQueue --> intent["Create or reuse whatsapp_payment_intent"]
  intent --> cashfreeOrder["Create/reuse Cashfree PG Order, cf_order_id"]
  cashfreeOrder --> cta["WhatsApp CTA -> /pay/token/<crqid>"]
  cta --> payPage["/pay/token/[crqid] page"]
  payPage --> checkout["Cashfree hosted Checkout"]
  checkout --> cashfreeWebhook["/webhooks/cashfree"]
  cashfreeWebhook --> verify["Verify signature, amount, order_id"]
  verify --> confirm["confirmPaymentByCrqid"]
  confirm --> finalize["finalize_booking job"]
```

Order correlation uses a **Cashfree-side id, not the intent id directly**: the first order for an
intent uses `cf_order_id = crqid` (easy to read in logs), but if that order later expires and the
guest re-triggers the flow, the retry gets a short random suffix
(`${crqid}-${randomSuffix}`) so Cashfree's own order-id-uniqueness rule never blocks a retry.
`app/webhooks/cashfree` matches on the stored `cf_order_id` column, not on `crqid` directly, so
either shape resolves back to the right booking.

## What changed

### New: `lib/cashfree/orders.ts` — server-only PG Orders client

`createCashfreeOrder()` calls `POST /pg/orders` with `x-client-id` / `x-client-secret` /
`x-api-version` headers, returning `payment_session_id`, `cf_order_id`, `order_status`, and
`order_expiry_time`. Sandbox vs production base URL is controlled by `CASHFREE_ENVIRONMENT`.
Guarded with `import "server-only"` — the secret key can never end up in a client bundle.

### New: `lib/cashfree/pure.ts` — `parseCashfreePaymentWebhook`

Parses the PG Orders payment webhook shape (`data.order.*` + `data.payment.*` +
`data.customer_details.*`), branching on `payment_status` rather than the top-level `type` string
so a differently-named event with the same shape still parses. The old
`parseCashfreePaymentLinkWebhook` (Payment Links `PAYMENT_LINK_EVENT`) is kept for audit-only
logging in case a stray event from the retired static-link flow ever arrives.

### `supabase/migrations/20260917000100_0022_cashfree_pg_orders.sql` — new columns

Adds `cf_order_id`, `payment_session_id`, `cf_payment_id`, `cashfree_order_status`,
`cashfree_payment_status`, `cashfree_bank_reference`, `cashfree_order_expires_at` to
`whatsapp_payment_intents`, with partial unique indexes on `cf_order_id` and `cf_payment_id` for
idempotency. `payment_link_url` (from migration `0020`) is repurposed to hold our own
`/pay/token/<crqid>` URL instead of a Cashfree URL. `0020`/`0021` are left as-is (already
applied) — this is a forward-only correction, not an edit to applied history.

**This migration has not been applied automatically by this change** — apply it the same way
prior migrations were applied (Supabase SQL editor or `supabase db push`) before deploying the
code in this change.

### `lib/whatsapp/sendTokenPaymentLink.ts` — create-or-reuse a Cashfree order

After `upsertPaymentIntent`, `ensureCashfreeOrderForIntent` either reuses the intent's existing
active order (unexpired `payment_session_id`) or creates a new one, then sends the WhatsApp CTA
to `/pay/token/<crqid>` (via `buildTokenPaymentPageUrl`) instead of a Cashfree URL.
`STATIC_TOKEN_PAYMENT_LINK_URL` is removed — it no longer has a caller.

### New: `app/pay/token/[crqid]/page.tsx` + `features/token-payment/components/`

Server component that loads the payment intent, and renders one of: already paid, link needs a
refresh (missing/expired session), or the Cashfree Checkout button
(`CashfreeCheckoutButton.tsx`, using `@cashfreepayments/cashfree-js`'s `load()` +
`cashfree.checkout()`). A returning-from-checkout state with a manual `RefreshStatusButton.tsx`
covers the gap between the browser redirect and the webhook landing, without ever trusting the
redirect itself for fulfillment.

### `app/webhooks/cashfree/route.ts` — canonical webhook, now finalizes bookings

Verifies the Cashfree HMAC signature (same scheme as before), parses the PG Orders payment
webhook, looks up the matching `whatsapp_payment_intents` row by `cf_order_id`, validates the
paid amount against `amount_inr`, and — only on `payment_status = "SUCCESS"` — builds an
`InboundWhatsAppPayment` and calls the existing `confirmPaymentByCrqid`
(`lib/whatsapp/webhook/processWhatsAppWebhook.ts`), then drains `job_queue` in `after()` so
`finalize_booking` runs in the same request. Non-success statuses (FAILED/USER_DROPPED/etc.) are
logged but don't touch the intent — an order can often accept another attempt before it expires,
so one failed attempt shouldn't close out the booking.

`app/api/cashfree/webhook/route.ts` (the old path) now just re-exports and delegates to this
handler, so a webhook config that still points at the old URL keeps working.

### Edge Function: `send_token_payment_link` intentionally not registered

`supabase/functions/job-queue-worker/index.ts` invokes on demand, on insert, and every minute via
`pg_cron` — and `lib/jobs/drainDueJobs.ts` tries it *before* the Next.js fallback. Since Cashfree
order creation only exists in the Next.js handler (it's a plain `fetch` from
`lib/cashfree/orders.ts`, nothing Deno-specific stops it from being ported, but duplicating it
risks two implementations drifting again like the previous MSG91 `payment_link` Edge copy did), we
deliberately removed `send_token_payment_link` from the Edge Function's `HANDLERS` map instead of
porting it. `claim_due_jobs` is called with `Object.keys(HANDLERS)`, so the Edge worker now never
claims this job type — it's left `queued` for the Next.js `processDueJobs` fallback exclusively,
avoiding a race between two different implementations. The now-dead Deno files
(`supabase/functions/_shared/handlers/sendTokenPaymentLink.ts` and
`supabase/functions/_shared/tokenPaymentLink.ts`) were deleted rather than left as unused code.

### Env vars

Added `CASHFREE_CLIENT_ID`, `CASHFREE_ENVIRONMENT` (`sandbox` | `production`),
`CASHFREE_API_VERSION` (defaults to `2023-08-01`), and `NEXT_PUBLIC_APP_BASE_URL` (defaults to
`https://cab-bnb.vercel.app` in code — `lib/utils/appUrl.ts`). `CASHFREE_SECRET_KEY` is reused
for both the PG Orders API call and webhook signature verification, same as Cashfree's documented
scheme.

## Testing performed

- `npm test` (170 tests) — added `lib/cashfree/pure.test.ts` coverage for
  `parseCashfreePaymentWebhook` and a new `lib/cashfree/orders.test.ts` with mocked `fetch` for
  success, a Cashfree 4xx error, and missing credentials. Updated
  `lib/whatsapp/tokenPaymentLink.test.ts` for `buildTokenPaymentPageUrl` in place of the removed
  static-link constant.
  - `lib/cashfree/orders.ts` uses `import "server-only"`, which unconditionally throws outside
    Next's server bundler. `npm test` now runs with `tsx --conditions=react-server`, the export
    condition that resolves `server-only` to its no-op build — see the comment in
    `lib/cashfree/orders.test.ts`.
- `npx tsc --noEmit` — clean. Added `types/cashfree-js.d.ts` since
  `@cashfreepayments/cashfree-js` ships no TypeScript types.
- `npm run lint` — no new errors/warnings (a handful of pre-existing, unrelated ones elsewhere
  were left as out of scope).
- `npm run build` — succeeds; `/pay/token/[crqid]` and `/webhooks/cashfree` both build as dynamic
  routes alongside the existing `/api/cashfree/webhook` alias.

## What's still open

- **Migration 0022 needs to be applied** to the live database before this code path can work end
  to end (see above).
- **No live sandbox/production Cashfree payment was run against this build** as part of this
  change — do that next: create a token intent, open `/pay/token/<crqid>`, pay with a Cashfree
  sandbox test card/UPI/OTP `111000`, and confirm the webhook marks the intent `paid` and runs
  `finalize_booking`. Also test a duplicate webhook delivery and a failed/dropped payment.
- **Balance (remaining-amount) payments are unaffected** —
  `lib/whatsapp/sendBalancePaymentLink.ts` still uses MSG91's own `payment_link` type, which
  remains blocked by `s2s_enabled_not_approved`. Migrating balance payments to the same PG Orders
  pattern is a reasonable follow-up but was out of scope here.
