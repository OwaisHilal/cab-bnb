# 2026-09-28 Session Breakdown: Why We Reverted Back To `1925a9a`

## Why this document exists

On 2026-09-28 we spent the day building multi-trip support, a Cashfree
"never reopen an already-paid order" fix, and a handful of WhatsApp/journey UX
fixes, across two separate implementation attempts. By the end of the day a
"deep logical breakdown" appeared in the running app that could not be
isolated or fixed with confidence. Rather than keep patching an app whose
state model had grown three overlapping sources of truth in one day, we made
the call to hard-reset the whole codebase back to `1925a9a727f1430bde3cb88c8e46f608c6bc8a8d`
— the last commit before any of this day's work started (previous commit,
`7e8d2e1`, was from 2026-09-25) — and start this feature set over tomorrow
with a clear head.

This document is **not** a changelog of things still in the app. Everything
described below has been undone. It exists purely as a reference: what we
were trying to build, what we actually built, and — as honestly as we can
assess without a live repro — what in this design is the most likely source
of the breakdown, so we don't walk into the same holes tomorrow.

The 10 commits below are still fully inspectable if any of this needs to be
re-derived: `git log 1925a9a..7d4e8de` locally, or on GitHub at
`origin/archive/2026-09-28-reimplementation` (a branch pointing at the old
tip, pushed before this revert).

---

## The three problems we were trying to solve (all day)

1. **Multiple trips per phone number.** A tourist who already has one trip
   in flight should be able to start a second one on the same phone number,
   see a list of all their trips, and switch between them — without one
   trip's poll/cookie ever clobbering another's.
2. **Never reopen a Cashfree checkout that Cashfree already marked `PAID`.**
   If our own DB row was stale (still "active") but Cashfree's side already
   confirmed payment, tapping "Pay" again should never open a second
   checkout — it should finalize the booking from the already-paid order.
3. **Four specific WhatsApp/journey bugs** the user had found in production:
   assign-driver rejecting seeded (non-RFC-4122) driver/vehicle ids; the
   driver/car photo card being sent twice; a Cashfree return screen still
   showing a live "Pay" button after the payment had already gone through
   (or, conversely, no way to pay again if checkout was abandoned); and a
   new trip getting stuck forever on "Opening this trip."

Two separate implementation waves were built today to solve these, and a
scoped revert happened in between them.

---

## Wave 1 — original build-out (commits 1–5, never reverted until today's full reset)

### 1. `3d3fc22` — `feat(payment): integrate PayNowButton and enhance payment flow` (19:22)

**Intent:** Stop showing the tourist two different-looking buttons back to
back (a plain "Pay now" button, then a swap to `CashfreeCheckoutButton` once
the intent was created) — collapse "create the payment intent" and "open
Cashfree Checkout" into one persistent button. Also give the confirmed-trip
screen a driver photo and an itemized payment receipt instead of just a name
and phone number.

**What was built:**
- `features/journey/components/PayNowButton.tsx` (new) — one button, three
  internal phases (`idle` → `creating` → `opening`), owns its own
  idempotency key (`crypto.randomUUID()`, reused across retries of the same
  attempt), lazy-loads `@cashfreepayments/cashfree-js` only once tapped, and
  calls a caller-supplied `onCreateIntent(idempotencyKey)` to get the
  session before opening Checkout.
- `ChooseQuoteCard.tsx` / `DriverBalanceCard.tsx` — gutted their own
  `isStartingPayment`/`session`/`error` state and `idempotencyKeyRef`, and
  now just hand `PayNowButton` a `createIntent` callback.
- `components/ui/Button.tsx` — added `pay` / `payOnGreen` variants (green
  "this completes a payment" color, or white-on-green for cards that are
  already green).
- `features/journey/components/DriverAvatar.tsx` (new) + `lib/utils/publicAssetUrl.ts`
  (new) — driver photo, falling back to vehicle stock photo, falling back to
  a `ui-avatars.com` initials avatar. `publicAssetUrl.ts` normalizes
  `drivers.photo_url`/`vehicles.stock_photo_url` (which can be a full URL, a
  `/`-prefixed path, or a `public/`-prefixed path) into a browser-loadable
  `<img src>`.
- `ConfirmedCard.tsx` — added `paymentBreakdownLines()` (token+balance split
  for `token_99` bookings, single line for `full_payment`), a receipt card,
  and "Call driver" / "WhatsApp driver" action buttons.
- `lib/whatsapp/completeBalancePayment.ts` — added `sendDriverPhotoCard()`,
  sending a composed driver/vehicle image card via WhatsApp right before the
  existing `driver_contact_v1` text message.
- `lib/journey/loadJourney.ts` / `types.ts` — `JourneyDriver` gained
  `driverPhotoUrl`/`vehiclePhotoUrl`, sourced from a wider Supabase select.

**Plausible bug sources:**
- `sendDriverPhotoCard` in `completeBalancePayment.ts` was **in addition to**
  an existing photo-card send already happening earlier in
  `sendBalancePaymentLink.ts` — this is exactly the "duplicate photo card"
  bug that had to be fixed later (commit 4, `184141f`). It shipped broken on
  day one and nobody caught it until the WhatsApp flow was manually tested.
- `PayNowButton` fully owns idempotency-key generation and retry state
  internally, but nothing in this commit enforces that `ChooseQuoteCard`
  remounts it (`key={selectedQuoteId}`) is the *only* way it gets reset — any
  future caller that reuses one `PayNowButton` instance across two different
  logical payments (e.g. token, then later balance, without an unmount in
  between) would silently replay the first attempt's idempotency key.

### 2. `a231cd3` — `feat(booking): enhance booking flow with saved journey support` (19:55)

**Intent:** Let a tourist who already has a trip in flight land on the home
screen and see a "Continue your booking" card instead of either (a) forcing
them straight into the booking screen on every visit, or (b) showing nothing
at all.

**What was built:**
- New `savedJourney` state in `useBookingFlow.ts` — a `JourneyProjection`
  snapshot that gets set by **two different writers**: the cookie-resume
  effect (a trip found via the `kmr_journey` cookie) and
  `journeySync.journey` syncing (the live poll, once it lands).
- `app/page.tsx` — new `RealJourneyRoute` component: renders `journey` if
  present, else falls back to `savedJourney` **only if**
  `savedJourney.tripRequestId === tripRequestId`, else shows
  `EmptyBookingState`.
- `HomeHero.tsx` — new `ContinueBookingCard`, shown when `savedJourney` is
  set.
- `isResumingSession` moved from a `useState` lazy initializer (which reads
  `window.location` — a hydration mismatch, since SSR has no `window`) to
  `useState(false)` + `useLayoutEffect` that flips it true pre-paint if the
  URL has `?awaiting=token` or `?resume=1`.
- The cookie-resume effect was split into two behaviors: a plain visit
  (`GET /api/journey`, no special query params) now only calls
  `setSavedJourney(data)` (stores it, stays on home); an **explicit** resume
  (`?resume=1` or `?awaiting=token`) additionally calls the new
  `activateJourney(data)` (switches `screen` to `"booking"`).
- `continueSavedBooking()` — what the new `ContinueBookingCard` calls;
  reuses the already-fetched `savedJourney` via `activateJourney` instead of
  refetching.
- `navigateBooking()` — tapping the Booking tab before a trip is "continued"
  now redirects into `continueSavedBooking()` if `!isVerified && savedJourney`.

**Plausible bug sources — this is the single biggest one in the whole day's
work:** this commit is where **`savedJourney` was introduced as a third,
independent piece of state** alongside `journey` (the live poll,
`useJourneySync`) and `booking` (the `BookingStatusScreen`-shaped summary).
From this point on, `useBookingFlow.ts` had to keep three overlapping
representations of "what trip is the tourist looking at" in sync by hand,
via a growing number of effects each with their own guard conditions. Every
later commit in both waves had to add another special case to keep these
three in sync (e.g. wave 2's bail-out guard
`if (tripRequestId && journeySync.journey.tripRequestId !== tripRequestId) return;`
was a direct patch on top of this exact problem). A single canonical
"current trip" state, derived once, would have avoided an entire class of
"stale trip's data flashes over the new trip" bugs that both waves spent
real effort chasing individually instead of eliminating at the root.

### 3. `a5b922b` — `feat(journey): enhance trip management and payment flow` (20:52)

**Intent:** Multiple trips per phone number (trip list, switch-trip API,
profile trip previews, "Book another cab" everywhere it makes sense), plus
the first version of "never reopen a Cashfree order that's already `PAID`."

**What was built (full detail already captured before this revert in
[docs/reimplementation/last-3-commits-reference.md](docs/reimplementation/last-3-commits-reference.md),
commit `3cd874d`):**
- New: `app/api/journey/switch/route.ts`, `app/api/journey/trips/route.ts`,
  `lib/journey/loadTripList.ts`, `lib/journey/tripList.ts` (+ tests),
  `lib/cashfree/reuseOrder.ts` (+ tests), `TripListScreen.tsx`,
  `BookAnotherCabButton.tsx`.
- `lib/whatsapp/ensureCashfreeOrderForIntent.ts` rewritten: DB row already
  `PAID` → skip Cashfree entirely and report `alreadyPaid`; otherwise, if the
  DB row looks reusable, check Cashfree live and branch on
  `decideReusableCashfreeOrder` (`reuse` / `confirm_paid` / `replace`).
- `useJourneySync.ts` — mount effect started resetting `etagRef`/`stageRef`/
  `unchangedPollsRef` on `broadcastKey` change (previously only on `enabled`
  change).

**Plausible bug sources:**
- This is where `openTrip()`/`/api/journey/switch` were introduced as **a
  second way to change which trip is active**, alongside `savedJourney`'s
  `activateJourney()` from commit 2 and the plain `tripRequestId` setter used
  elsewhere. Three different code paths could now change "the current trip,"
  each updating a different subset of `tripRequestId`/`savedJourney`/`booking`/
  the journey cookie — a classic setup for one path to leave stale state
  behind that another path doesn't know to clear.
- `ensureCashfreeOrderForIntent.ts`'s live Cashfree lookup on every payment
  attempt (even ones that don't need it) adds a new external-call failure
  mode into a function that previously only touched our own DB — the "lookup
  failure → reuse existing session anyway" fallback is reasonable in
  isolation, but it was never exercised end-to-end against a real Cashfree
  sandbox outage during today's testing.

### 4. `184141f` — `feat(payment): enhance payment flow with new features and error handling` (21:52)

**Intent:** Fix the four WhatsApp flow bugs found in production: assign-driver
seeded ids, duplicate photo card, dead/wrong Cashfree return UI, and (partial)
the new-trip "Opening this trip" stall. Also added a dev-only reset script.

**What was built (full detail in
[docs/reimplementation/last-3-commits-reference.md](docs/reimplementation/last-3-commits-reference.md)):**
- `app/api/vendor/assign-driver/route.ts`: `z.string().uuid()` → `z.guid()`.
- Removed the duplicate `sendDriverPhotoCard` call added in commit 1
  (`3d3fc22`) from `completeBalancePayment.ts`.
- `app/pay/token/[crqid]/page.tsx` rewritten around a new
  `resolveReturnView()` returning one of `received / confirming / unpaid /
  payable / stale`, backed by the new shared
  `features/token-payment/components/PaymentReturnPanel.tsx`.
- `lib/journey/reconcilePendingPayment.ts`: `isStuckReconcilable` gained a
  `skipAgeCheck` option; `reconcilePendingPaymentIfStuck`'s return type
  changed from `Promise<boolean>` to a 3-way
  `Promise<"finalized" | "unpaid" | "pending">`.
- `lib/journey/loadJourney.ts` / `types.ts`: new `checkoutLeftUnpaid` flag on
  `JourneyProjection`, driven by the new `ReconcileOutcome`.
- `useJourneySync.ts`: added `pollAgainRef` to coalesce an in-flight poll
  instead of dropping a new request; mount/trip-change effect now also
  resets `hasLoadedRef`/`journey`/`error` (not just the etag/stage refs).
- `useBookingFlow.ts`: new `checkoutClosed` state; the effect clearing
  `awaitingTokenConfirmation` was rewritten around `checkoutLeftUnpaid`; a
  bail-out guard added so a poll response for a *different* trip than the
  currently-selected one is ignored.
- New `scripts/reset-tourist-bookings.ts`.

**Plausible bug sources:**
- Changing `reconcilePendingPaymentIfStuck`'s return type from a boolean to a
  3-way enum, in the same commit that also changes every one of its callers,
  is a wide-blast-radius change to land in one go alongside three unrelated
  fixes (assign-driver, photo card, reset script). Any one of those changes
  breaking something makes it harder to isolate which change was at fault —
  and this is likely part of why the later "revert only the last 3 commits"
  attempt still didn't isolate the actual problem: the *first* photon-card
  fix and the *second* Cashfree-return fix landed in the same commit as
  wave 1's already-shaky trip-switching/`savedJourney` model.
- `checkoutLeftUnpaid`, `skipAgeCheck`, and `justReturnedFromTokenCheckout`
  became three separate booleans all influencing the same stage-derivation
  branch in `loadJourney.ts`. Each was added to solve one specific scenario,
  but their *interaction* (e.g. what happens when all three are true at
  once, or when `skipAgeCheck` fires for a trip that was never actually
  "just returned") was never enumerated or tested as a truth table.

### 5. `3a9d7bd` — `feat(journey): refine session handling and enhance trip request flow` (22:04)

**Intent:** A same-day follow-up specifically for a tourist who is already
verified and creates a **second** trip — stop it from getting stuck on
"Opening this trip."

**What was built (full detail in
[docs/reimplementation/last-3-commits-reference.md](docs/reimplementation/last-3-commits-reference.md)):**
- `app/api/journey/route.ts`: removed `attachJourneyCookie(...)` from both
  the `304` and `200` branches of `GET /api/journey` — the journey cookie is
  no longer refreshed on every poll, only on explicit switch/verify actions.
- `app/api/trip-requests/route.ts`: added `runtime = "nodejs"`; if the
  request is same-origin and already carries a valid journey session cookie,
  it now calls `completePhoneVerification({..., verifiedBy: "existing_session"})`
  synchronously inside trip creation, linking the new trip to the existing
  tourist and switching the journey cookie in the same request/response —
  no separate `/api/journey/switch` round trip.
- `lib/otp/completePhoneVerification.ts`: `PhoneVerificationSource` gained
  `"existing_session"`.
- `useBookingFlow.ts`: `runDispatch(vendorCount, openBooking)` — when
  `openBooking` is true, skips the OTP sheet entirely and jumps straight to
  the booking detail screen.

**Plausible bug sources:**
- This commit **removed** the journey cookie's per-poll refresh (`GET
  /api/journey` no longer calls `attachJourneyCookie`), while commit 3
  (`a5b922b`, `/api/journey/switch`) and this same commit's
  `trip-requests/route.ts` change both *add* new cookie-writing code paths.
  By the end of wave 1, the journey cookie was written from three different
  routes (`switch`, `trip-requests` on link, and the original
  otp-verify/phone-email-verify paths) but *not* from the poll route — a
  behavior change made same-day, under time pressure, specifically to fix a
  race, is exactly the kind of change most likely to have an untested edge
  case (e.g. a cookie written by `trip-requests` racing a cookie written
  moments earlier by `switch`, if a tourist rapid-fires "book another cab").
- This was the **last** commit of wave 1 before the user found the app
  broken enough to ask for a scoped revert — meaning it shipped with the
  least amount of manual regression testing behind it of any wave-1 commit.

---

## The pivot: scoped revert (commits 6–7)

### 6. `3cd874d` — `docs: capture reference for the three commits about to be reverted` (22:17)

Reference doc for commits 3–5 only (`a5b922b`, `184141f`, `3a9d7bd`) —
written so nothing they implemented would be lost when reverted. Did **not**
cover commits 1–2 (`3d3fc22`, `a231cd3`), because at the time those two
weren't believed to be part of the problem.

### 7. `9cc39d8` — `revert: back out multi-trip, cashfree-reuse, and whatsapp-flow session changes` (22:19)

History-preserving `git revert` of exactly commits 3–5. Left commits 1–2
(`PayNowButton`, `savedJourney`/`RealJourneyRoute`/`ContinueBookingCard`)
fully in place, on the theory that the trip-list/cashfree-reuse/session-cookie
changes were the specific source of the breakage.

**In hindsight, this is the most important process mistake of the day:**
the revert scope was picked based on which commits *introduced* the features
most recently touched, not on which commits were actually suspected of
causing the specific symptoms observed. Commit 2 (`a231cd3`) is what
introduced `savedJourney` as a third source of truth in the first place —
the root architectural issue every later commit (in both waves) had to keep
patching around — and it was never reverted or even re-examined until this
full reset.

---

## Wave 2 — reimplementation in isolated, tested slices (commits 8–10)

Built deliberately smaller and independently verified (typecheck + full test
suite + production build after each slice), specifically **not** replaying
wave 1's exact mechanisms where a first-principles read of the code
suggested a better one — see the deviations called out in each commit
message below. All three passed 282 automated tests, a clean typecheck, and
a clean production build before being pushed.

### 8. `00f80c6` — `feat(cashfree): never reopen a checkout Cashfree already marked PAID` (22:24)

Reintroduced `lib/cashfree/reuseOrder.ts` (`isReusableCashfreeOrder`,
`decideReusableCashfreeOrder`) with unit tests, wired
`ensureCashfreeOrderForIntent` to confirm-and-finalize instead of issuing a
fresh Checkout session once Cashfree reports `PAID` for an order our DB
still calls active. Propagated `alreadyPaid` through the token/balance
prepare functions, both journey payment API routes, and
`PayNowButton`/`ChooseQuoteCard`/`DriverBalanceCard` so the client refreshes
the journey instead of reopening Checkout.

This slice is functionally close to wave 1's `a5b922b` Cashfree-reuse logic
by design (that logic tested fine in isolation) — the difference from wave 1
is scope: this commit touches *only* the Cashfree-reuse path, none of the
trip-switching/session code that shipped alongside it in `a5b922b`.

**Plausible bug sources:** none identified in isolation (this slice's tests
passed and its logic was unchanged from the well-reviewed wave-1 version) —
but see "Cross-cutting risk patterns" below for how this interacts with
`savedJourney` (never removed) once combined with slices 9–10.

### 9. `90247e2` — `feat(journey): support multiple trips without cookie races` (22:45)

Reintroduced the trip list/switch APIs and UI. `useBookingFlow` now tracks
`bookingView` (`list`/`detail`) and `tripList`, with `openTrip` as **the
single path** that switches trips — used by the trips list, `ProfileScreen`,
and by `trip-requests` right after it links a brand-new trip to an
already-verified session.

Two deliberate deviations from wave 1's `a5b922b`/`3a9d7bd`, based on a
from-first-principles read of the cookie/polling code rather than replaying
the design the user found broken in production:
- `GET /api/journey` no longer rewrites the journey cookie on its own
  responses at all (same end state as wave 1 arrived at via `3a9d7bd`, but
  reasoned about directly instead of discovered via a race).
- `useJourneySync`'s poll-mount effect depends on `broadcastKey` (not just
  `enabled`), and `openTrip` calls `journeySync.refresh()` right after the
  cookie switch resolves, so a trip switch triggers an immediate poll
  instead of waiting out the previous trip's backoff schedule.
  `RealJourneyRoute` only trusts `journey`/`savedJourney` when their
  `tripRequestId` matches the active one, showing a brief "Opening this
  trip" state otherwise instead of flashing the old booking.

**Plausible bug sources:**
- `savedJourney` (from wave 1's `a231cd3`, never revisited) was **still**
  being written by the cookie-resume effect and by the `journeySync.journey`
  sync effect, *in addition to* this slice's new `openTrip`/`bookingView`
  state. This slice added a fourth way trip identity could change
  (`openTrip`) on top of three pre-existing ones, rather than replacing them.
  The "only trust `journey`/`savedJourney` when `tripRequestId` matches"
  guard is a symptom-level patch on exactly this problem, not a fix to the
  underlying multiple-sources-of-truth design.
- `trip-requests/route.ts` links but does **not** re-cookie a new trip for an
  already-verified session; the client is expected to separately call the
  same `/api/journey/switch` path via `openTrip`. This is two sequential
  network round-trips (create trip, then switch) with no transactional
  guarantee between them — if the second call fails or races a concurrent
  poll, the server-side link and the client-side "current trip" can disagree.

### 10. `7d4e8de` — `feat(journey): fix assign-driver ids, duplicate photo card, and Cashfree return UI` (23:09)

Reimplemented the remaining wave-1 fixes: `assign-driver` seeded ids,
duplicate photo card removal, the five-view Cashfree return UI
(`received`/`confirming`/`unpaid`/`payable`/`stale` via `PaymentReturnPanel`),
`JourneyScreen`'s inline `awaitingTokenConfirmation`/`checkoutClosed`/
`checkoutLeftUnpaid` states, `useJourneySync` poll-coalescing, the
different-trip poll-response guard in `useBookingFlow`, a real "We couldn't
open this trip" + Try again UI (replacing an indefinite loading state), and
the restored `scripts/reset-tourist-bookings.ts`.

**Plausible bug sources:**
- By this point, `loadJourney.ts`'s stage derivation depended on
  `checkoutLeftUnpaid`, `skipAgeCheck`, and `justReturnedFromTokenConfirmation`
  simultaneously (same risk flagged under wave 1 commit 4, `184141f` —
  reimplemented with the same interacting-booleans shape rather than
  collapsing them into one explicit state machine).
- This was the **last commit of the entire day**, layering a fifth commit's
  worth of changes onto files (`useBookingFlow.ts`, `JourneyScreen.tsx`,
  `useJourneySync.ts`) that had already been rewritten multiple times across
  both waves in the same session. Automated tests and a production build
  passed, but per the user's own direction, **no further browser-based
  manual regression testing was performed across the full combination of
  both waves before this was pushed to `origin/main`** — the "deep logical
  breakdown" was discovered only after this push, during manual testing in
  what was effectively production.

---

## Cross-cutting risk patterns (what most likely caused this)

1. **Four overlapping sources of "what trip/journey is currently active"
   accumulated over one day:** `tripRequestId`, `journeySync.journey` (the
   live poll), `savedJourney` (introduced in `a231cd3`, never removed or
   consolidated), and `booking` (the `BookingStatusScreen`-shaped summary
   derived from either of the above, depending on flow). Every commit after
   `a231cd3` — in both waves — added another guard clause
   (`tripRequestId !== tripRequestId` checks, `hasLoadedRef` resets, etag
   resets on `broadcastKey`) to stop one of these four from clobbering
   another, instead of collapsing them into one canonical state derived in
   one place. This is the single most likely structural cause of "a new
   trip flashes/keeps the wrong trip's data" style bugs, and it was never
   actually eliminated — only patched around, in increasingly specific ways,
   all day.

2. **The scoped revert (`9cc39d8`) picked the wrong boundary.** It reverted
   the three most recently touched commits (`a5b922b`, `184141f`, `3a9d7bd`)
   without re-examining `a231cd3`, which is where the `savedJourney`
   architecture that every later commit fought against was actually
   introduced. A revert scoped by "which commits are suspected of causing
   the specific observed symptom" (which would have required reproducing and
   bisecting the symptom first) would likely have looked different from a
   revert scoped by "which commits are most recent."

3. **The journey cookie's write timing changed three times in one day**
   (refreshed on every poll → not refreshed on poll, only on
   switch/verify/link → same end state reimplemented from scratch in wave
   2). Cookie/session timing bugs are inherently hard to reproduce
   deterministically (they depend on request ordering and timing), meaning
   each of these changes was probably undertested relative to how load-bearing
   it was.

4. **`reconcilePendingPaymentIfStuck`'s contract changed shape mid-session**
   (`Promise<boolean>` → `Promise<"finalized" | "unpaid" | "pending">`), and
   `loadJourney.ts`'s final stage derivation grew to depend on three
   separate booleans (`checkoutLeftUnpaid`, `skipAgeCheck`,
   `justReturnedFromTokenCheckout`) whose combined truth table was never
   enumerated or tested as a whole — only each flag's own "happy path" was
   covered by a unit test.

5. **No end-to-end manual regression pass across the *combination* of both
   waves' work happened before pushing to `origin/main`.** Automated
   tests (282 of them) and a clean production build gave confidence that
   each *slice* worked in isolation, but multi-trip switching, Cashfree
   reuse, and the four WhatsApp fixes all touch the same handful of files
   (`useBookingFlow.ts`, `loadJourney.ts`, `useJourneySync.ts`,
   `JourneyScreen.tsx`) — exactly the kind of change where unit tests can
   all pass while the integrated behavior is still wrong.

---

## Lessons for tomorrow

- **Pick one canonical "current trip" state before writing any UI around
  it.** `journeySync.journey` (the live poll result) should probably be the
  single source of truth for "what's on screen right now"; anything else
  (a cookie-resume snapshot, a home-screen preview) should be a clearly
  temporary placeholder that is fully replaced — never merged or
  conditionally trusted — once the real poll lands.
- **When reverting, revert the entire related commit group, not just the
  most recent N commits.** Trace a feature back to where its foundational
  state/architecture was introduced, not just to where it was last touched.
- **Boolean flags that all feed one branch of logic
  (`checkoutLeftUnpaid`/`skipAgeCheck`/`justReturnedFromTokenCheckout`-style)
  should be modeled as one explicit enum/state machine with every
  combination considered, not as independently-added booleans.**
- **Before pushing multi-file journey/payment changes to `origin/main`
  (which auto-deploys), do one full manual click-through of the affected
  flows in combination** — not just per-slice automated tests — especially
  when multiple slices touch the same files in the same session.
- **Keep a written reference (like this doc) whenever a revert happens**,
  even a small one — it's what made reconstructing today's full picture
  possible at all.
