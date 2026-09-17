# ₹99 Token Payment: Static Cashfree Link Rollback — What We Did and Why

> **Superseded 2026-09-17.** The static-link workaround this doc explains was replaced by
> Cashfree PG Orders, which restores per-booking payment confirmation — see
> [`2026-09-17-cashfree-pg-orders-integration.md`](./2026-09-17-cashfree-pg-orders-integration.md).
> This narrative is kept as-is below for the historical record of *why* the static link was the
> right call at the time.

This documents the full investigation and rollback for the ₹99 token payment link sent after a
tourist taps **Select {vendor}** on WhatsApp. It's a narrative companion to the more
reference-style [`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md) —
read that one for the technical flow/code map; read this one for *how we got here and why each
decision was made*.

## TL;DR

- Two independent Cashfree approval gates block **every** automated, per-booking payment-link
  path on this merchant account. Neither can be fixed in code — both need Cashfree merchant
  approval.
- The fix: send **one dashboard-created static Cashfree link** for every ₹99 token payment,
  delivered as a WhatsApp CTA-URL button, instead of creating a unique link per booking.
- The trade-off: because the link is shared, we can no longer automatically confirm *which*
  booking a payment belongs to. Cashfree's webhook is kept only as an audit log; confirming a
  token payment and unlocking a booking is a manual step for now.
- All dead code from the abandoned dynamic-link attempt was removed, not just disabled.

## Timeline of the investigation

### 1. Symptom: nothing arrives on WhatsApp after tapping "Select {vendor}"

The user reported that tapping a vendor selection button produced no follow-up message. Earlier
debugging sessions (see the linked companion doc) had already ruled out the inbound-webhook
reachability problem — the tap *was* reaching our backend and resolving to the `book_token`
action correctly.

### 2. Root-caused with real Vercel logs, not guesses

Rather than speculating, we pulled the actual production runtime logs via `vercel logs` for the
exact request timestamp of a reproduced tap. The logs were unambiguous:

```text
[whatsapp webhook] inbound { last4: '8789', action: 'book_token', ... }
[token pay] cashfree link result {
  quoteSnapshotId: 'd830ea0c-...',
  success: false,
  configured: true,
  error: 'Cashfree Payment Links API returned 400: {"code":"PaymentLink_link_creation_api_failed","message":"link_creation_api is not enabled or approved. Please reach out to care@cashfree.com.","type":"feature_not_enabled"}'
}
[whatsapp webhook] jobs { claimed: 1, succeeded: 0, failed: 1 }
```

This told us everything: credentials were configured correctly (`configured: true`), the job was
claimed and ran, but **Cashfree's own API rejected the call** with `feature_not_enabled`.

### 3. Two separate Cashfree blocks, not one

This was the second of two independent Cashfree integration paths we'd tried, and both turned out
to be gated by merchant-account approval:

| # | Path | Result |
|---|------|--------|
| 1 | MSG91's session `payment_link` interactive type (uses Cashfree's Orders/S2S API under the hood) | Blocked: `s2s_enabled_not_approved` |
| 2 | Cashfree's own dynamic Payment Links create-API (`POST /pg/links`), tried as a direct workaround for #1 | Blocked: `link_creation_api is not enabled or approved` |

Neither of these is a bug in our code — both require Cashfree support/KYC approval to enable a
merchant-account feature flag. No amount of retrying, header tweaking, or payload changes fixes
an account-level `feature_not_enabled` response.

### 4. Decision: fall back to the manually shared static link

The user had earlier manually created a Payment Link through the **Cashfree merchant dashboard
UI** (not the API) and shared it as a proof it worked:
`https://payments.cashfree.com/links/Cb0o4hnupupg_AAAAAAAVUJE`. Dashboard-created links aren't
gated by `link_creation_api` — only the *programmatic* create call is. So the agreed fix was: stop
trying to create a link per booking, and send this one static link to everyone.

We considered and rejected two alternatives before landing here:

- **Wait for Cashfree approval and keep dynamic links** — rejected for now because it blocks
  shipping; approval timelines are outside our control.
- **Auto-confirm payments from the shared link's webhook** — rejected as unsafe. Every booking
  would share the same Cashfree `link_id`, so a webhook event can't be trusted to belong to one
  specific quote/booking. Auto-finalizing on that basis risks unlocking the wrong booking (or
  double-unlocking) for a customer who never paid.

## What changed and why

### `lib/whatsapp/sendTokenPaymentLink.ts` — send the static link instead of creating one

- Removed the `createCashfreePaymentLink` / `getCashfreeWebhookNotifyUrl` calls entirely. There is
  no more per-booking Cashfree API request in this flow.
- Added `STATIC_TOKEN_PAYMENT_LINK_URL` (in `lib/whatsapp/tokenPaymentLink.ts`) and send it via
  the existing, already-proven `sendWhatsAppCtaUrlMessage` ("Pay 99" button).
- Removed the `alreadySent` early-return. Previously, once an intent was marked `sent`, a second
  tap on the same open quote was silently ignored — that made sense when creating a link was an
  expensive, stateful, real-money API call we didn't want to repeat. With a static link there's
  nothing to "recreate," so repeated taps on an open quote now just resend the same CTA. This also
  fixed a source of confusing "nothing happens" reports during earlier testing, where a prior
  failed attempt had already flipped the intent to `sent` before the send actually succeeded.
- `whatsapp_payment_intents` and `whatsapp_message_log` still get written per tap (status,
  `payment_link_url`, WAMID) — that bookkeeping remains valuable for support/ops even though it's
  no longer used to correlate an inbound Cashfree webhook.

### `app/api/cashfree/webhook/route.ts` — downgraded from "confirms bookings" to "audit log"

Previously, this route parsed `PAYMENT_LINK_EVENT` webhooks and called `confirmPaymentByCrqid`
to automatically mark a `whatsapp_payment_intents` row paid and enqueue `finalize_booking`. That
logic assumed each Cashfree `link_id` mapped 1:1 to one `whatsapp_payment_intents.crqid` — true
when we created a unique link per booking, false now that every payment goes through the same
static link.

The route still verifies the Cashfree HMAC signature (`x-webhook-signature` +
`x-webhook-timestamp`, `crypto.timingSafeEqual`) and parses the payload — that part is
unaffected by the static-link change and still guards against spoofed requests. What it does with
a valid event changed: it now only logs `linkId`, `status`, amounts, event time, and the
customer's phone **last 4 digits** (never the full number) for manual/ops review, and no longer
enqueues any job. Confirming a specific booking's token payment is a manual step until a
per-booking correlation mechanism exists again (e.g. if Cashfree later approves the dynamic
create-API, or metadata support becomes available another way).

### Cron and reconciliation — removed, not disabled

`lib/cashfree/reconcile.ts` polled `GET /pg/links/{link_id}` per stale intent as a missed-webhook
safety net. With one shared `link_id` for every booking, polling that endpoint returns the *same*
overall link status for every stale intent — it could not distinguish "this specific customer
paid" from "someone, somewhere, paid the shared link." Keeping it would have been actively unsafe
(it could confirm the wrong booking), so it was deleted rather than left dormant, along with its
call site in `app/api/cron/dispatch-jobs/route.ts`.

### Dead code removal — deleted, not commented out

Per explicit instruction, everything that only existed to support the abandoned dynamic-link
attempt was removed outright rather than left as unused/dead code:

- Deleted `lib/cashfree/client.ts` (credential-reading wrapper around the create/get API calls).
- Deleted `lib/cashfree/reconcile.ts` (see above).
- Deleted `scripts/cashfree-payment-link-smoke-test.ts` (a manual real-money smoke test for the
  now-unsupported create API).
- Trimmed `lib/cashfree/pure.ts` down from a full Cashfree API client to just the two things the
  webhook route still needs: `verifyCashfreeWebhookSignature` and
  `parseCashfreePaymentLinkWebhook`. Removed the create-link body builder, duplicate-`link_id`
  handling, expiry-time formatting, customer-phone normalization, and the raw HTTP request
  helpers — none of that code has a caller anymore.
- Trimmed `lib/cashfree/types.ts` to only the webhook-related types (`CashfreePaymentLinkWebhookData`,
  `ParsedCashfreeWebhook`, `VerifyCashfreeWebhookSignatureInput`), removing the credential/create-input/
  API-result types.
- Rewrote `lib/cashfree/pure.test.ts` to drop tests for the removed create/get functions, keeping
  only signature-verification and webhook-parsing coverage.
- Confirmed with a repo-wide search that no remaining code references
  `createCashfreePaymentLink`, `getCashfreePaymentLink`, `CASHFREE_APP_ID`,
  `CASHFREE_API_VERSION`, `CASHFREE_WEBHOOK_NOTIFY_URL`, or `cashfreeReconcile`.

**Left alone, on purpose:** `supabase/functions/_shared/handlers/sendTokenPaymentLink.ts` (a Deno
Edge Function copy of the old flow) still contains the pre-rollback dynamic-link code. It was
explicitly out of scope for this change — that Edge Function currently fails to invoke in
production, so the Next.js in-process job handler (`lib/jobs/processDueJobs.ts`) handles every
job today. It's flagged as a known gap in the docs rather than silently fixed, so whoever
eventually gets `job-queue-worker` deploying again knows to port this same change there first.

### Database migration `0020` — kept, corrected with a new migration instead of edited

Migration `20260914000100_0020_cashfree_payment_links.sql` (which added the `cf_link_id` and
`payment_link_url` audit columns, and originally set the `token_lock_payment_v1` template's notes
to describe the dynamic-link flow) had **already been applied** to the database before we
discovered the `link_creation_api` block. Editing or deleting an already-applied migration file
would create drift between the migration history on disk and what actually ran against the
database — a classic source of "works on my machine" bugs for anyone who re-runs migrations from
scratch later.

Instead, we added a new migration, `20260914000200_0021_static_cashfree_token_link.sql`, that only
`UPDATE`s the `whatsapp_message_templates.notes` column for `token_lock_payment_v1` to describe
the current static-link + audit-only architecture. The `cf_link_id` and `payment_link_url`
columns from `0020` were kept as-is — they're harmless audit fields now, and dropping them would
be a destructive, unnecessary schema change.

### Env vars and docs — updated to describe reality, not aspiration

- `.env.example`: removed `CASHFREE_APP_ID`, `CASHFREE_API_VERSION`, and
  `CASHFREE_WEBHOOK_NOTIFY_URL` since no code reads them anymore. Kept `CASHFREE_SECRET_KEY`,
  documented as only needed if the audit-only webhook route stays deployed.
- `docs/cashfree-payment-links-workaround.md`, `docs/whatsapp-select-no-payment-link.md`, and
  `docs/msg91-whatsapp-integration.md` were all updated to stop describing a per-booking dynamic
  link and instead describe the static link + manual-confirmation trade-off, so the next person
  debugging this doesn't chase a create-API call that no longer exists.

## Verification performed

- `npm test` — all 163 tests passing, including the rewritten Cashfree webhook tests and a new
  assertion that `STATIC_TOKEN_PAYMENT_LINK_URL` / `TOKEN_PAY_BUTTON_TITLE` are wired correctly.
- `npx tsc --noEmit` — clean, no type errors.
- `npm run build` — succeeds, `/api/cashfree/webhook` and `/api/cron/dispatch-jobs` still build
  correctly with the trimmed imports.
- `ReadLints` on every touched file — no linter errors introduced (a couple of pre-existing,
  unrelated warnings/errors elsewhere in the repo were left as out of scope).

## What's still open

- **No automated payment confirmation.** This is the main known limitation. A booking's ₹99 token
  payment must currently be confirmed manually (e.g. by checking the Cashfree dashboard against
  the customer's phone number and timing) before treating it as locked.
- **Deno Edge Function copy is stale**, as noted above — port the static-link change there if
  `job-queue-worker` is ever deployed and enabled again.
- **Balance (remaining-amount) payments are unaffected** — `lib/whatsapp/sendBalancePaymentLink.ts`
  still uses MSG91's `payment_link` type and MSG91's own "On Payment Report Received" webhook,
  which is a separate, still-blocked-by-`s2s_enabled_not_approved` path that this rollback did not
  touch.
