# 2026-10-15 — OTP re-prompt fix + Cashfree checkout regression, rolled back

## Why this doc exists

Two things happened in the same work session and the same push to `origin/main`:

1. A fix for tourists being re-asked for OTP after returning from Cashfree payment.
2. A separate, already-in-progress feature (opening Cashfree Checkout directly
   from the in-app "Pay" tap, instead of navigating to `/pay/token/<crqid>`
   first) that was committed and pushed in the same batch.

After the push, live production (`kashmir.cab`) started showing Cashfree's
generic "Something went wrong" screen when tapping Pay. The repo was hard
reset to `3961be7` (`feat(booking-flow): enhance dispatch and OTP handling in
booking process`) to get back to the last known-good state. **This reset
undoes both the OTP fix and the checkout-flow feature below** — neither is
live after the reset.

## Commits removed by the reset

- `014ab2d` — `feat(booking-flow): enhance session management and checkout
  flow` (the OTP fix, see below).
- `86e22b5` — `feat(cashfree): enhance checkout process and environment
  handling` (the direct-checkout feature, not authored in this session —
  already sitting uncommitted locally before this session started, and
  pushed alongside the OTP fix).

## Part 1 — OTP re-prompt fix (`014ab2d`)

### Problem

Tourists completing a Cashfree payment and getting redirected back into the
app were sometimes shown the "verify your number" OTP sheet again, even
though the trip underneath had already loaded correctly as paid.

### Root cause

A race between two independent effects in `useBookingFlow`:

- The mount effect resolves a per-tab `sessionId` from `sessionStorage`
  (`getOrCreateClientSessionId()`), which does **not** reliably survive a
  full-page redirect round trip to Cashfree and back (most notably on
  Android, where a UPI app-switch can evict the page's process).
- A separate "cookie bridge" effect (`GET /api/auth/session`) re-establishes
  identity from the durable, httpOnly `kmr_customer_session` cookie, but
  runs asynchronously and could lose the race against the OTP overlay logic
  reading a stale/empty session id.

### Fix implemented

- `lib/utils/clientSession.ts` — added `adoptClientSessionId(sessionId)`:
  validates a UUID-shaped session id and writes it into `sessionStorage`
  for this tab, falling back to `getOrCreateClientSessionId()` for anything
  malformed.
- `lib/cashfree/buildCheckoutReturnUrl.ts` (new, pure/testable) — the
  Cashfree `return_url` built in `app/api/guest-trip/checkout/route.ts` now
  carries `&sid=<session_id>` so the session id survives the redirect round
  trip explicitly, instead of relying solely on `sessionStorage`.
- `app/page.tsx` — reads the `sid` query param from the Cashfree return URL
  and passes it into `useBookingFlow`.
- `features/booking-request/hooks/useBookingFlow.ts` — the mount effect
  prefers the `sid` carried through the return URL (via
  `adoptClientSessionId`) over a fresh/stale `sessionStorage` read; the
  cookie-bridge effect now closes the OTP overlay once identity is
  reconfirmed, gated on a `resumeModeRef` (to avoid a stale-closure read of
  `resumeMode` inside the async effect).
- Unit tests added for `adoptClientSessionId` and `buildCheckoutReturnUrl`.
  Full suite (278 tests) was green and `tsc --noEmit` was clean before this
  was committed.

### Confidence this fix itself is the regression

**Low.** The only place this fix touches anything Cashfree-related is
appending a harmless `&sid=<uuid>` query string (~41 extra characters,
unreserved characters only, nothing `encodeURIComponent` escapes) onto
`order_meta.return_url`. It does not touch Cashfree order creation, the
Checkout SDK load call, environment selection, or `payment_session_id`
handling in any way.

## Part 2 — Direct-checkout feature (`86e22b5`) — the actual suspected cause

This commit was **not written in this session** — it was already sitting as
uncommitted local changes before the OTP-fix work started, and got
committed/pushed in the same batch. It changed `handlePay` in
`features/guest-trip/hooks/useGuestTrip.ts` to open Cashfree's hosted
Checkout directly from the same tap, instead of navigating to
`/pay/token/<crqid>` first:

```ts
const handlePay = useCallback(async () => {
  ...
  preloadCashfree("production") // <-- hardcoded, unconditional
  try {
    const response = await fetch("/api/guest-trip/checkout", ...)
    ...
    if (data.paymentSessionId && data.returnUrl && data.environment) {
      const result = await openCashfreeCheckout({
        paymentSessionId: data.paymentSessionId,
        returnUrl: data.returnUrl,
        environment: data.environment, // comes back from the server as "sandbox" or "production"
      })
      ...
```

### Suspected root cause of "Something went wrong"

1. `preloadCashfree("production")` fires immediately on tap, **before** the
   server has responded with the deployment's actual configured
   environment.
2. The server then responds with `environment: "sandbox"` (this deployment
   has `CASHFREE_ENVIRONMENT=sandbox` set, intentionally, for testing on the
   production domain), and `openCashfreeCheckout` is called a second time
   with `environment: "sandbox"`.
3. The installed `@cashfreepayments/cashfree-js` package
   (`node_modules/@cashfreepayments/cashfree-js/dist/script.esm.js`) loads
   **one single global script** from a fixed URL
   (`https://sdk.cashfree.com/js/v3/cashfree.js`) via a module-level
   singleton promise, completely independent of the `mode` passed to
   `load()`. The mode is only applied afterward by calling the resulting
   global `window.Cashfree({ mode })` factory.
4. Net effect: on one Pay tap, `window.Cashfree({ mode: "production" })` is
   called, immediately followed by `window.Cashfree({ mode: "sandbox" })` on
   the same already-loaded script instance — a sequence the widget was
   almost certainly never built/tested for. The sandbox
   `payment_session_id` then gets handed to a widget in a mixed-mode state,
   and Cashfree's hosted checkout fails with its generic "Something went
   wrong" screen.

### Why this matches the reported symptom exactly

- It only manifests when the deployment's real `CASHFREE_ENVIRONMENT` is
  **not** `"production"` — i.e. exactly the sandbox-credentials-on-prod-domain
  setup being used for testing. With real production credentials, the
  hardcoded preload and the real mode always match, so this path would not
  have been caught by normal production traffic.
- It is new specifically because `preloadCashfree("production")` and the
  dual-call sequence did not exist before `86e22b5`.

### Confidence level

**Plausible and circumstantially strong, not independently proven.** I
verified the shipped `cashfree-js` loader code confirms the single
global-script, mode-applied-via-factory-call design described above, and
confirmed the hardcoded `"production"` string only diverges from the real
deployment setting in this exact sandbox-on-prod scenario. I could not
inspect the actual externally-hosted `window.Cashfree` factory's internal
state handling (it loads from Cashfree's own CDN, not from this repo), so I
cannot be 100% certain this double-call sequence is the full explanation
rather than a contributing factor.

### Proposed fix (not yet applied — reset chosen instead)

Remove the hardcoded `preloadCashfree("production")` call (or make it read
an environment-aware, client-exposed value, e.g. a
`NEXT_PUBLIC_CASHFREE_ENVIRONMENT` build var, instead of a literal) before
re-attempting this feature.

## Resolution taken

Rather than debug further on a live, user-facing payment path, the repo was
hard reset to `3961be7778a80246921a73638590dddbd0766db93`
(`feat(booking-flow): enhance dispatch and OTP handling in booking process`),
the last commit before both of the above landed. **`origin/main` was left
untouched by the reset itself** — a separate, explicit force-push decision
is required to make this rollback take effect on `kashmir.cab`, since
`origin/main` is currently ahead at `014ab2d`.
