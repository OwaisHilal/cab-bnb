# Website trip booking implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest finish the same cab booking on the website that WhatsApp already runs, with one server snapshot and the same guest steps.

**Architecture:** A pure step function decides Quotes, Lock, Token received, Balance, or Driver contact from the existing trip, quote, payment, and booking rows. One session-gated GET returns that snapshot. Select and pay call `handleSendTokenPaymentLink` and the existing Cashfree intent. The browser holds only that snapshot and polls it. Do not revive `lib/journey` or keep a second booking object beside it.

**Tech Stack:** Next.js App Router route handlers, existing Supabase service role, existing Cashfree checkout, `node:test` via `npx tsx --conditions=react-server --test`.

## Global Constraints

- One trip in progress per verified phone. A second trip waits until this one is cancelled or the balance is confirmed. A finished driver-contact trip still opens on return until a newer trip starts.
- A new visit asks for the phone and OTP again. A refresh in the same tab reopens the trip without OTP.
- The browser keeps one copy of the trip, loaded from the server. The server decides which guest step that trip is on.
- Choosing an operator, paying ₹99, and paying the balance on the site call the same server paths WhatsApp already uses.
- WhatsApp messages still go out. A failed send does not block the website step.
- Cancel is available on the trip page for now, including after payment. Closed means `trip_requests.status = 'abandoned'`. If a booking exists, `bookings.status = 'cancelled'`.
- Vendor assign-driver, the driver assignment text, reminders, check-in, and the review stay on WhatsApp only.
- The page is not a fake WhatsApp chat and not a custom stepper. Guest copy comes from the existing builders in `lib/whatsapp/quoteChoiceTemplate.ts`, `lib/whatsapp/tokenPaymentLink.ts`, `lib/whatsapp/tokenReceivedAck.ts`, and `lib/whatsapp/balancePaymentLink.ts`.
- A payment counts only after `app/webhooks/cashfree/route.ts` confirms it. The site does not mark an intent paid, except `DEMO_MODE`, which uses `confirmPaymentByCrqid`.
- Driver phone is present on the snapshot only when the step is `driver_contact`.
- Negotiation floors and `min_quote_floor` are never returned.
- Before writing a route handler, read the matching guide in `node_modules/next/dist/docs/`.

---

### Task 1: Pure guest step and current-trip picker

**Files:**
- Create: `lib/guest-trip/types.ts`
- Create: `lib/guest-trip/deriveGuestStep.ts`
- Create: `lib/guest-trip/deriveGuestStep.test.ts`
- Create: `lib/guest-trip/pickCurrentGuestTrip.ts`
- Create: `lib/guest-trip/pickCurrentGuestTrip.test.ts`
- Modify: `package.json` `test` script (append the two new test files)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `GuestStep = "quotes_waiting" | "quotes" | "lock" | "token_received" | "balance" | "driver_contact" | "closed"`
  - `deriveGuestStep(input: GuestStepInput): GuestStep`
  - `isTripInProgress(input: GuestStepInput): boolean`
  - `pickCurrentGuestTrip<T extends GuestTripCandidate>(rows: T[]): T | null`

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { deriveGuestStep, isTripInProgress } from "@/lib/guest-trip/deriveGuestStep"
import type { GuestStepInput } from "@/lib/guest-trip/types"

const base: GuestStepInput = {
  tripRequestStatus: "quotes_sent",
  quoteCount: 0,
  tokenIntentStatus: "none",
  driverAssigned: false,
  balanceIntentStatus: "none",
  balanceConfirmed: false,
}

describe("deriveGuestStep", () => {
  it("waits while no quote rows exist", () => {
    assert.equal(deriveGuestStep(base), "quotes_waiting")
  })

  it("shows quotes when rows exist and no token intent exists", () => {
    assert.equal(deriveGuestStep({ ...base, quoteCount: 2 }), "quotes")
  })

  it("shows lock while the token intent is unpaid", () => {
    assert.equal(deriveGuestStep({ ...base, quoteCount: 2, tokenIntentStatus: "pending" }), "lock")
    assert.equal(deriveGuestStep({ ...base, quoteCount: 2, tokenIntentStatus: "sent" }), "lock")
  })

  it("shows token received after the token is paid and before a driver", () => {
    assert.equal(
      deriveGuestStep({ ...base, quoteCount: 2, tokenIntentStatus: "paid", driverAssigned: false }),
      "token_received",
    )
  })

  it("shows balance after a driver is assigned and the balance is unpaid", () => {
    assert.equal(
      deriveGuestStep({
        ...base,
        quoteCount: 2,
        tokenIntentStatus: "paid",
        driverAssigned: true,
        balanceIntentStatus: "sent",
      }),
      "balance",
    )
  })

  it("shows driver contact only after the balance is confirmed", () => {
    assert.equal(
      deriveGuestStep({
        ...base,
        quoteCount: 2,
        tokenIntentStatus: "paid",
        driverAssigned: true,
        balanceIntentStatus: "paid",
        balanceConfirmed: true,
      }),
      "driver_contact",
    )
  })

  it("closes an abandoned trip even when quotes and a paid token exist", () => {
    assert.equal(
      deriveGuestStep({
        ...base,
        tripRequestStatus: "abandoned",
        quoteCount: 2,
        tokenIntentStatus: "paid",
        driverAssigned: true,
      }),
      "closed",
    )
  })
})

describe("isTripInProgress", () => {
  it("is in progress until the balance is confirmed", () => {
    assert.equal(isTripInProgress({ ...base, quoteCount: 1, tokenIntentStatus: "paid" }), true)
  })

  it("is finished once the balance is confirmed", () => {
    assert.equal(isTripInProgress({ ...base, balanceConfirmed: true }), false)
  })

  it("is not in progress when abandoned", () => {
    assert.equal(isTripInProgress({ ...base, tripRequestStatus: "abandoned", quoteCount: 1 }), false)
  })
})
```

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { pickCurrentGuestTrip } from "@/lib/guest-trip/pickCurrentGuestTrip"

describe("pickCurrentGuestTrip", () => {
  it("prefers the newest in-progress trip", () => {
    const picked = pickCurrentGuestTrip([
      { id: "old", createdAt: "2026-09-01T00:00:00.000Z", inProgress: true, finished: false, closed: false },
      { id: "new", createdAt: "2026-09-02T00:00:00.000Z", inProgress: true, finished: false, closed: false },
    ])
    assert.equal(picked?.id, "new")
  })

  it("returns the newest finished trip when nothing is in progress", () => {
    const picked = pickCurrentGuestTrip([
      { id: "done", createdAt: "2026-09-03T00:00:00.000Z", inProgress: false, finished: true, closed: false },
      { id: "closed", createdAt: "2026-09-04T00:00:00.000Z", inProgress: false, finished: true, closed: true },
    ])
    assert.equal(picked?.id, "done")
  })

  it("returns null when every row is closed", () => {
    assert.equal(
      pickCurrentGuestTrip([
        { id: "a", createdAt: "2026-09-01T00:00:00.000Z", inProgress: false, finished: false, closed: true },
      ]),
      null,
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx --yes tsx --conditions=react-server --test lib/guest-trip/deriveGuestStep.test.ts lib/guest-trip/pickCurrentGuestTrip.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the types and functions**

`lib/guest-trip/types.ts`:

```ts
export type GuestStep =
  | "quotes_waiting"
  | "quotes"
  | "lock"
  | "token_received"
  | "balance"
  | "driver_contact"
  | "closed"

export type GuestPaymentIntentStatus = "none" | "pending" | "sent" | "paid" | "failed" | "expired"

export interface GuestStepInput {
  tripRequestStatus: string
  quoteCount: number
  tokenIntentStatus: GuestPaymentIntentStatus
  driverAssigned: boolean
  balanceIntentStatus: GuestPaymentIntentStatus
  balanceConfirmed: boolean
}

export interface GuestTripCandidate {
  id: string
  createdAt: string
  inProgress: boolean
  finished: boolean
  closed: boolean
}
```

`lib/guest-trip/deriveGuestStep.ts`:

```ts
import type { GuestStep, GuestStepInput } from "@/lib/guest-trip/types"

const CLOSED_TRIP_STATUSES = new Set(["abandoned", "expired"])

export const deriveGuestStep = (input: GuestStepInput): GuestStep => {
  if (CLOSED_TRIP_STATUSES.has(input.tripRequestStatus)) return "closed"
  if (input.balanceConfirmed) return "driver_contact"
  if (input.driverAssigned) return "balance"
  if (input.tokenIntentStatus === "paid") return "token_received"
  if (input.tokenIntentStatus === "pending" || input.tokenIntentStatus === "sent") return "lock"
  if (input.quoteCount > 0) return "quotes"
  return "quotes_waiting"
}

export const isTripInProgress = (input: GuestStepInput): boolean => {
  const step = deriveGuestStep(input)
  return step !== "closed" && step !== "driver_contact"
}
```

`lib/guest-trip/pickCurrentGuestTrip.ts`:

```ts
import type { GuestTripCandidate } from "@/lib/guest-trip/types"

const byNewest = (a: GuestTripCandidate, b: GuestTripCandidate): number => {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

export const pickCurrentGuestTrip = <T extends GuestTripCandidate>(rows: T[]): T | null => {
  const inProgress = rows.filter((row) => row.inProgress && !row.closed).sort(byNewest)
  if (inProgress[0]) return inProgress[0]
  const finished = rows.filter((row) => row.finished && !row.closed).sort(byNewest)
  return finished[0] ?? null
}
```

Append both test paths to the `test` script in `package.json`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx --yes tsx --conditions=react-server --test lib/guest-trip/deriveGuestStep.test.ts lib/guest-trip/pickCurrentGuestTrip.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/guest-trip package.json
git commit -m "feat(guest-trip): derive the guest step from one trip record"
```

---

### Task 2: Refuse a second Cashfree checkout when the order is already paid

**Files:**
- Create: `lib/cashfree/decideCheckout.ts`
- Create: `lib/cashfree/decideCheckout.test.ts`
- Create: `lib/cashfree/fetchOrderStatus.ts`
- Modify: `package.json` `test` script

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: `decideCheckout(input: { intentStatus: string; cashfreeOrderStatus: string | null }): "already_paid" | "open_checkout"`
- Produces: `fetchCashfreeOrderStatus(orderId: string): Promise<string | null>`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { decideCheckout } from "@/lib/cashfree/decideCheckout"

describe("decideCheckout", () => {
  it("does not open checkout when our intent is paid", () => {
    assert.equal(decideCheckout({ intentStatus: "paid", cashfreeOrderStatus: "ACTIVE" }), "already_paid")
  })

  it("does not open checkout when Cashfree is ahead of our row", () => {
    assert.equal(decideCheckout({ intentStatus: "sent", cashfreeOrderStatus: "PAID" }), "already_paid")
  })

  it("opens checkout while the order is still active", () => {
    assert.equal(decideCheckout({ intentStatus: "sent", cashfreeOrderStatus: "ACTIVE" }), "open_checkout")
    assert.equal(decideCheckout({ intentStatus: "pending", cashfreeOrderStatus: null }), "open_checkout")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --yes tsx --conditions=react-server --test lib/cashfree/decideCheckout.test.ts`

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the decision and the order lookup**

```ts
export const decideCheckout = (input: {
  intentStatus: string
  cashfreeOrderStatus: string | null
}): "already_paid" | "open_checkout" => {
  if (input.intentStatus === "paid") return "already_paid"
  if (input.cashfreeOrderStatus === "PAID") return "already_paid"
  return "open_checkout"
}
```

`fetchCashfreeOrderStatus` uses the same client id, secret, API version, and sandbox/production base URL as `lib/cashfree/orders.ts`. `GET /orders/{orderId}`. Read `order_status`. Return `null` when credentials are missing, the response is not OK, or `order_status` is not a string. Do not mark any database row paid.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx --yes tsx --conditions=react-server --test lib/cashfree/decideCheckout.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/cashfree/decideCheckout.ts lib/cashfree/decideCheckout.test.ts lib/cashfree/fetchOrderStatus.ts package.json
git commit -m "feat(cashfree): skip checkout when the order is already paid"
```

---

### Task 3: Session-gated trip snapshot

**Files:**
- Create: `lib/guest-trip/loadGuestTrip.ts`
- Modify: `lib/guest-trip/types.ts` (add `GuestTripSnapshot`)
- Create: `app/api/guest-trip/route.ts`
- Test: `lib/guest-trip/deriveGuestStep.test.ts` already covers the step. This task adds no new pure test. Verify with the GET behavior below.

**Interfaces:**
- Consumes: `deriveGuestStep`, `GuestStep`
- Produces: `loadGuestTrip(supabase, input: { sessionId: string; confirming: "token" | "balance" | null }): Promise<GuestTripSnapshot | null>`
- Produces: `GET /api/guest-trip?session_id=&confirming=`

`GuestTripSnapshot` fields:

```ts
export interface GuestTripSnapshot {
  tripRequestId: string
  step: GuestStep
  tripSummary: string
  quotes: Array<{ id: string; vendorName: string; line: string }>
  bodyText: string
  hidePay: boolean
  paymentCrqid: string | null
  driverPhone: string | null
  footerText: string | null
  rideGroupInviteUrl: string | null
  resumedExisting: boolean
}
```

- [ ] **Step 1: Implement `loadGuestTrip`**

Load the trip whose `trip_requests.session_id` equals the query, or whose id is in `guest_trip_sessions` for that `session_id` once Task 7 adds that table. Until that table exists, matching `trip_requests.session_id` is enough. If several match, use `pickCurrentGuestTrip` after marking each row `inProgress` / `finished` / `closed` with `isTripInProgress` and `deriveGuestStep`. Return `null` when none match. Do not accept a trip id as the lookup key.

Select only customer-safe columns. Never select `min_quote_floor`.

Build `tripSummary` with `formatQuoteChoiceTripSummary`. Build each quote `line` with `formatQuoteChoiceLine`, ordered by `current_quote` ascending, and keep only the same rows WhatsApp sends: the lowest `QUOTE_CHOICE_MAX_QUOTES` (3). A fourth operator must not appear on the site if it was not in the WhatsApp quote message. Include `vendors.reliability_score` as the rating.

Build `bodyText` for the current step:

- `quotes_waiting`: `Your Kashmir cab quotes are on the way.` plus the trip summary on the next line.
- `quotes`: one quote uses the `quote_single_v1` body (`Your Kashmir Cab Quote` plus that operator’s price line). Two or three quotes use the `quote_choice_v1` body: `Your Kashmir cab quotes are in.`, the trip summary, the quote lines, and `Lowest price is listed first.` The site renders one Select button per operator shown, using the operator’s real name.
- `lock`: `buildTokenPaymentLinkCopy(...).bodyText` for the quote that owns the open token intent.
- `token_received`: `buildTokenReceivedAckMessage(...).bodyText`. If that helper needs the template store, call `ensureMessageTemplates` first, the same way `handleSendTokenPaymentLink` does.
- `balance`: `buildBalancePaymentLinkCopy` body from `lib/whatsapp/balancePaymentLink.ts`. Include driver name and vehicle. Do not include the driver phone.
- `driver_contact`: the `driver_contact_v1` body: payment received, driver name, phone, vehicle, operator, and `Driver will reach out before pickup. Safe travels!`
- `closed`: `This trip is closed.`

`driverPhone` is the driver phone only when `step === "driver_contact"`. Otherwise `null`.

When the derived step is `closed`, the client in Task 4 shows the home screen. The spec maps a cancelled trip to Home. `This trip is closed.` is the pay-page sentence in Task 8, not a trip-screen step.

`footerText` is the WhatsApp footer for that step, rendered under the body. Quotes: `Tap a button below to choose your cab.` Lock: `Pay ₹99 to lock this cab.` Balance: `Pay remaining balance to confirm.` Other steps: `null`.

`rideGroupInviteUrl` is `whatsapp_ride_groups.invite_link` for the booking when a row exists and `status` is not `deleted`. Otherwise `null`.

`hidePay` is true when `confirming` is `token` and the step is still `lock`, or `confirming` is `balance` and the step is still `balance`. When the payment is already confirmed, `hidePay` is false and the step is the later one.

Token intent for the step is the earliest `whatsapp_payment_intents` row with `purpose = 'token_lock'` and status `pending`, `sent`, or `paid`, joined through `quote_snapshots.trip_request_id`. Later intents for other quotes are ignored here. Task 5 expires those later rows. Balance intent is the earliest `purpose = 'balance'` row for the booking with those same statuses. `balanceConfirmed` is `bookings.payment_status === 'fully_paid'`. `driverAssigned` is a non-null `bookings.driver_id`.

- [ ] **Step 2: Implement the GET route**

Follow `app/api/trip-requests/[id]/route.ts` for `jsonOk` / `jsonError` and the service-role client. Query `session_id` is required. `confirming` may be `token`, `balance`, or absent. Missing session id returns 400. No matching trip returns 404 `{ error: "No trip for this session" }`.

- [ ] **Step 3: Manual check**

With an existing verified trip whose `trip_requests.session_id` you know, `GET /api/guest-trip?session_id=<that id>` returns `step: "quotes"` or `quotes_waiting` and no `min_quote_floor`. A random session id returns 404.

- [ ] **Step 4: Commit**

```bash
git add lib/guest-trip/loadGuestTrip.ts lib/guest-trip/types.ts app/api/guest-trip/route.ts
git commit -m "feat(guest-trip): load one session-gated trip snapshot"
```

---

### Task 4: Show the snapshot on the site

**Files:**
- Create: `features/guest-trip/hooks/useGuestTrip.ts`
- Create: `features/guest-trip/components/GuestTripScreen.tsx`
- Modify: `app/page.tsx`
- Modify: `features/booking-request/hooks/useBookingFlow.ts` only to expose `sessionId` and `tripRequestId` (already exposed) and to stop treating `booking` as the screen after verification

**Interfaces:**
- Consumes: `GET /api/guest-trip`, `GuestTripSnapshot`
- Produces: `useGuestTrip(sessionId: string, confirming: "token" | "balance" | null)` returns `{ snapshot, loadError, refresh }`

- [ ] **Step 1: Write the hook**

`useGuestTrip` stores one `GuestTripSnapshot | null`. It fetches `GET /api/guest-trip?session_id=&confirming=` on mount and every 3 seconds while `document.visibilityState === "visible"`. On a failed response or network error it keeps the previous snapshot and sets `loadError` to `Still trying to refresh this trip.` A 404 clears nothing if a snapshot already exists; it sets `loadError` and keeps polling. It does not create a second booking object.

Persist nothing beyond the session id that `getOrCreateClientSessionId` already stores. Same-tab refresh calls this GET again because `sessionStorage` still has that id.

- [ ] **Step 2: Write `GuestTripScreen`**

Render `snapshot.tripSummary`, `snapshot.bodyText`, and `snapshot.footerText` with `whitespace-pre-wrap`. No stepper. Do not mount `MockWhatsAppChat` from this screen. Demo pay is this screen’s Pay button.

In `useBookingFlow`, stop `pollTripRequestSnapshot` once the guest is verified. The guest snapshot is the only live trip object. Leaving that poll running would recreate the second copy this design exists to avoid.

The dispatch animation still runs once, before OTP, as it does today. After OTP it does not run again. Waiting for quotes is the calm line from the snapshot.

- `quotes`: one button per quote, label `Select ${quote.vendorName}`, `aria-label` the same. The click handler is wired in Task 5; until then the button is present and disabled only while `selecting` is true. Pass `onSelect(quoteId)`.
- `lock` and `balance`: button `Pay ₹99` or `Pay` plus the balance amount from the body, hidden when `hidePay` is true. When `hidePay` is true, show `Confirming your payment.` above the body.
- `driver_contact`: `Call` (`tel:`) and `WhatsApp` (`https://wa.me/`) using `driverPhone`, and `Join ride group` when `rideGroupInviteUrl` is set.
- When `snapshot.step` is `closed`, clear the snapshot and show the home screen. Do not render a closed-trip card.
- Every step except a null snapshot: a `Cancel request` button. Wire it in Task 8.
- `loadError` is a `role="alert"` line. It does not replace the snapshot.

Use the existing Tailwind tokens (`font-archivo`, `text-kmr-ink`, `bg-kmr-blue`, `bg-kmr-green`). No new CSS file.

- [ ] **Step 3: Mount it from the home page**

In `app/page.tsx`, when `flow.screen === "booking"` and `flow.sessionId` is non-empty, render `GuestTripScreen` instead of `BookingStatusScreen`. Read `confirming` from `useSearchParams`: `token` or `balance` only. After OTP, that booking screen is the snapshot, and the quote template is already being sent. The dispatch animation still runs only before OTP. The request sheet stays as it is. If no operators match, the form keeps today’s error, the trip screen does not open, and no WhatsApp template is sent.

Leave `BookingStatusScreen` in the repo unused by `app/page.tsx`. Do not delete it in this task.

The empty booking tab, when the GET returns 404 and there is no snapshot, keeps today’s empty state. Task 7 adds `Continue with your phone`.

- [ ] **Step 4: Check in the browser**

Start a trip in the existing form, accept the OTP, and confirm the booking screen shows `Your Kashmir cab quotes are on the way.` or `Your Kashmir cab quotes are in.` Refresh the same tab and confirm the same step returns without another OTP. Disconnect the network and confirm the last body stays on screen with `Still trying to refresh this trip.`

- [ ] **Step 5: Commit**

```bash
git add features/guest-trip app/page.tsx features/booking-request/hooks/useBookingFlow.ts
git commit -m "feat(guest-trip): show the server trip step on the booking screen"
```

---

### Task 5: Select an operator from the site

**Files:**
- Create: `lib/guest-trip/selectQuoteForGuest.ts`
- Create: `app/api/guest-trip/select/route.ts`
- Modify: `features/guest-trip/components/GuestTripScreen.tsx`
- Modify: `features/guest-trip/hooks/useGuestTrip.ts`

**Interfaces:**
- Consumes: `handleSendTokenPaymentLink(supabase, { quote_snapshot_id })`, `loadGuestTrip`
- Produces: `POST /api/guest-trip/select` body `{ session_id, quote_snapshot_id }` returns `GuestTripSnapshot`

- [ ] **Step 1: Implement `selectQuoteForGuest`**

Load the quote and its trip. The session is allowed when it equals `trip_requests.session_id` or a `guest_trip_sessions` row for that trip. If it is not allowed, return `{ ok: false, status: 404, message: "No trip for this session" }`. Checking only `trip_requests.session_id` would reject the second tab.

Enqueue `send_token_payment_link` the same way a WhatsApp `BOOK_TOKEN` tap does, then drain that job the same way `completePhoneVerification` drains `send_quotes`, so the ₹99 intent exists before the response. Do not call `handleSendTokenPaymentLink` a second time from this route. The job queue retries a failed send. If a token intent already exists for another quote on this trip with status `pending`, `sent`, or `paid`, do not enqueue another. If two token intents exist afterward, keep the earliest of those statuses and set the later ones to `expired`. Return `loadGuestTrip`. If no intent exists, the snapshot step stays `quotes`.

- [ ] **Step 2: Implement the route**

Zod: `session_id` string min 1, `quote_snapshot_id` uuid. 400 on a bad body.

- [ ] **Step 3: Wire the Select button**

`onSelect` POSTs the route, then `refresh()`. On 500, set `loadError` to the response message and leave the quotes on screen. On success, the next snapshot’s step is `lock` and `bodyText` starts with `Lock this cab with a ₹99 token.`

- [ ] **Step 4: Check both channels**

Select on the site and confirm the lock body appears and WhatsApp receives the ₹99 message. On a second browser, select a different operator in WhatsApp first, refresh the site, and confirm the other Select buttons are gone. Select the same operator twice and confirm there is still one `whatsapp_payment_intents` row.

- [ ] **Step 5: Commit**

```bash
git add lib/guest-trip/selectQuoteForGuest.ts app/api/guest-trip/select/route.ts features/guest-trip
git commit -m "feat(guest-trip): lock an operator from the site with the WhatsApp payment path"
```

---

### Task 6: Pay from the site and return to the trip

**Files:**
- Create: `app/api/guest-trip/checkout/route.ts`
- Modify: `app/pay/token/[crqid]/page.tsx`
- Modify: `features/guest-trip/hooks/useGuestTrip.ts`
- Modify: `features/guest-trip/components/GuestTripScreen.tsx`

**Interfaces:**
- Consumes: `decideCheckout`, `fetchCashfreeOrderStatus`, `confirmPaymentByCrqid`, `isDemoMode`
- Produces: `POST /api/guest-trip/checkout` body `{ session_id, crqid }` returns `{ outcome: "already_paid" }`, `{ outcome: "show_next_step", step: "token_received" | "driver_contact" }`, `{ outcome: "confirming" }`, or `{ outcome: "checkout", href: string }`

- [ ] **Step 1: Implement the checkout route**

Load the intent and the trip through its quote or booking. 404 when this `session_id` is not allowed to read the trip (Task 7). Do not update the intent in this route.

When `isDemoMode()` is true, call `confirmPaymentByCrqid` with `paid: true` and this `crqid`, then return `{ outcome: "already_paid" }`. Do not call Cashfree.

Otherwise fill `cashfreeOrderStatus` from the row, or from `fetchCashfreeOrderStatus(cf_order_id)` when the row is not paid and `cf_order_id` is set. If the Cashfree lookup returns `null`, treat the status as unknown and continue from the database row.

- Intent status `paid`: return `{ outcome: "already_paid" }`. The client refreshes. The snapshot moves to token received, or to driver contact when this payment was the balance.
- Cashfree status is `PAID` while the intent row is not: return `{ outcome: "show_next_step", step: "token_received" }` for a token payment, or `step: "driver_contact"` for a balance payment. Do not write `paid`. The client renders that step’s body and hides Pay until a poll shows the database has reached that step. This is the spec rule that the screen moves forward when Cashfree is ahead of our row, while only the webhook marks the intent paid.
- Cashfree is not paid yet and the guest just returned from checkout: return `{ outcome: "confirming" }`. The client stays on the lock or balance body, hides Pay, and shows `Confirming your payment.` until the webhook advances the step.
- Otherwise call `ensureCashfreeOrderForIntent` for that intent so an expired Cashfree session is replaced and the same payment row is reused. When that call creates a new order, set its return URL to `/?continue=1&confirming=token` or `confirming=balance`. An order Cashfree is already reusing keeps the return URL it was created with, which for a WhatsApp link is `/pay/token/<crqid>`. That page links back to the trip. Return `{ outcome: "checkout", href: "/pay/token/<crqid>" }`.

- [ ] **Step 2: Point the pay page back at the trip**

In `app/pay/token/[crqid]/page.tsx`, replace `BackToWhatsAppHint` with a link labeled `Back to your trip`. When `order_id` is present and the intent is not paid, the link is `/?continue=1&confirming=token` or `confirming=balance` to match `intent.purpose`. Otherwise the link is `/?continue=1`. Paid copy says the token or balance is confirmed and uses `/?continue=1`. It does not say to check WhatsApp. The confirming state already says `Confirming your payment…` and keeps `RefreshStatusButton`. Add the same trip link there. The trip screen reads `confirming` and sets `hidePay` until the snapshot moves past `lock` or `balance`.

- [ ] **Step 3: Wire Pay on the trip screen**

The Pay button POSTs checkout. On the balance step, if `paymentCrqid` is null, the checkout route calls `handleSendBalancePayment` on the server before it decides the outcome. The browser does not call that function. One job retry is the existing queue. Pay still appears when the intent exists even if the WhatsApp send failed. `already_paid` calls `refresh()`. `show_next_step` renders the token-received or driver-contact body and hides Pay until the polled snapshot reaches that step. `confirming` keeps the lock or balance body, hides Pay, and shows `Confirming your payment.` If a driver is assigned while token payment is still confirming, the polled step becomes `balance` and that body replaces the confirming lock body. `checkout` sets `window.location.href` to `href`.

- [ ] **Step 4: Check the payment edges**

Pay ₹99 from the site and from the WhatsApp link. Confirm one intent. Leave checkout and pay again. Confirm the same intent is reused. After the webhook, the trip screen shows the token-received body and hides Pay. Repeat for the balance after a driver is assigned: the balance body has the driver name and car and no phone; after payment the driver-contact body has the phone, Call, and WhatsApp.

- [ ] **Step 5: Commit**

```bash
git add app/api/guest-trip/checkout/route.ts app/pay/token features/guest-trip
git commit -m "feat(guest-trip): pay the existing Cashfree intent from the trip screen"
```

---

### Task 7: Resume on a new visit, and do not start a second in-progress trip

**Files:**
- Create: `supabase/migrations/20260929000100_0026_guest_trip_sessions.sql`
- Create: `lib/guest-trip/findCurrentGuestTrip.ts` (loads rows, then calls `pickCurrentGuestTrip`)
- Create: `app/api/guest-trip/resume/route.ts`
- Modify: `lib/otp/completePhoneVerification.ts`
- Modify: `app/api/otp/verify/route.ts`
- Modify: `app/api/otp/phone-email/verify/route.ts`
- Modify: `app/phone-email/callback/page.tsx`
- Modify: `features/booking-request/hooks/useBookingFlow.ts`
- Modify: `features/booking-request/components/HomeHero.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `pickCurrentGuestTrip`, `isTripInProgress`, `loadGuestTrip`
- Produces: `CompletePhoneVerificationResult` ok branch gains `tripRequestId: string` and `resumedExisting: boolean`
- Produces: `POST /api/guest-trip/resume` body `{ session_id, phone_e164, otp_code }` returns `GuestTripSnapshot`

- [ ] **Step 1: Extend `completePhoneVerification`**

`findCurrentGuestTrip(supabase, touristId)` loads the rows and calls `pickCurrentGuestTrip`. `completePhoneVerification` and `POST /api/guest-trip/resume` both use it. After the tourist upsert, load that tourist’s trips through that function. A row is `closed` when status is `abandoned` or `expired`. A row is `finished` when its booking `payment_status` is `fully_paid`. A row is `inProgress` when `isTripInProgress` is true. If `pickCurrentGuestTrip` returns an in-progress trip whose id is not `tripRequestId`, set the new request’s status to `abandoned` only when its status is `matching`, `quotes_ready`, or `otp_pending`, and return `{ ok: true, touristId, tripRequestId: existing.id, resumedExisting: true }` without enqueueing `send_quotes`. Otherwise keep today’s link-and-enqueue behavior and return `tripRequestId` plus `resumedExisting: false`.

Do not replace `trip_requests.session_id` when a second tab or device verifies the same phone. Add `guest_trip_sessions` (`session_id text primary key`, `trip_request_id uuid not null references trip_requests(id) on delete cascade`, `created_at timestamptz not null default now()`). Service role only, same RLS posture as `trip_requests`. On verify and on resume, insert this tab’s `session_id` for the resolved trip. `loadGuestTrip` matches a trip when `trip_requests.session_id` equals the query or a `guest_trip_sessions` row does. The first tab keeps polling. Cancel deletes the session rows for that trip.

- [ ] **Step 2: Return the resolved id from both verify routes**

`app/api/otp/verify/route.ts` and `app/api/otp/phone-email/verify/route.ts` return `trip_request_id` from the result, not from the request body, plus `resumed_existing`. `app/phone-email/callback/page.tsx` reads that response and writes the returned `trip_request_id` into the resume payload. It must not keep the new request id from before the redirect when `resumed_existing` is true.

- [ ] **Step 3: Teach the client to follow that id**

In `useBookingFlow`, when verify returns `resumed_existing: true`, replace `tripRequestId` with `trip_request_id` and set a one-shot notice `You already have a trip in progress.` `GuestTripScreen` shows that notice once above the body. Do not keep the discarded request on screen.

- [ ] **Step 4: Add resume for a browser with no session trip**

`POST /api/guest-trip/resume` checks the OTP with the same `verifyOtpCode` rules as `app/api/otp/verify/route.ts`. It does not create a trip request. It finds the tourist by phone, runs `pickCurrentGuestTrip`, inserts this tab’s `session_id` into `guest_trip_sessions` for that trip, and returns `loadGuestTrip`. No current trip returns 404 `{ error: "No trip for this phone" }`.

A return visit lands on the home screen. Home shows `Continue with your phone` when this tab has no snapshot. The empty booking tab shows the same button. Both open the OTP sheet in resume mode. `/?continue=1` does the same when the GET snapshot 404s. Submit calls resume instead of `/api/otp/verify`. Success clears `continue` from the URL and shows the snapshot at the current step. 404 sends the guest to the home screen.

A normal form submit that then verifies still goes through `completePhoneVerification`, which performs the same in-progress check.

- [ ] **Step 5: Check the identity edges**

Refresh the same tab: no OTP, same step. Open a second tab, enter the same phone and code, and confirm both tabs stay on that step. Close the tab, open the site, choose Continue with your phone, enter the code: the current step opens. Fill a new request with a phone that already has a trip in progress: the new request is abandoned and the existing trip opens with `You already have a trip in progress.` A phone with no trip returns home.

- [ ] **Step 6: Commit**

```bash
git add lib/guest-trip lib/otp/completePhoneVerification.ts app/api/otp app/api/guest-trip/resume features/booking-request app/page.tsx features/guest-trip
git commit -m "feat(guest-trip): resume the in-progress trip for a verified phone"
```

---

### Task 8: Cancel, and ignore a late payment on a closed trip

**Files:**
- Create: `app/api/guest-trip/cancel/route.ts`
- Modify: `lib/whatsapp/paymentReport.ts`
- Modify: `lib/whatsapp/paymentReport.test.ts`
- Modify: `lib/whatsapp/webhook/processWhatsAppWebhook.ts`
- Modify: `lib/whatsapp/sendTokenPaymentLink.ts`
- Modify: `lib/whatsapp/sendBalancePaymentLink.ts`
- Modify: `lib/whatsapp/assignDriverToBooking.ts`
- Modify: `app/pay/token/[crqid]/page.tsx`
- Modify: `features/guest-trip/components/GuestTripScreen.tsx`
- Modify: `features/guest-trip/hooks/useGuestTrip.ts`
- Modify: `features/booking-request/hooks/useBookingFlow.ts`

**Interfaces:**
- Consumes: `shouldEnqueuePaidFollowup`
- Produces: `POST /api/guest-trip/cancel` body `{ session_id }` returns `{ ok: true }`
- Produces: `shouldEnqueuePaidFollowup` returns false when `tripRequestStatus` is `abandoned` or `expired`, or `bookingStatus` is `cancelled`

- [ ] **Step 1: Extend the failing payment-report test**

Add this case to `lib/whatsapp/paymentReport.test.ts`:

```ts
it("does not enqueue a follow-up for a closed trip", () => {
  assert.equal(
    shouldEnqueuePaidFollowup({
      action: "token_lock",
      quoteStatus: "sent",
      tripRequestStatus: "abandoned",
    }),
    false,
  )
  assert.equal(
    shouldEnqueuePaidFollowup({
      action: "balance",
      bookingPaymentStatus: "token_paid",
      bookingStatus: "cancelled",
    }),
    false,
  )
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes tsx --conditions=react-server --test lib/whatsapp/paymentReport.test.ts`

Expected: FAIL because the new fields are ignored and the follow-up still returns true.

- [ ] **Step 3: Implement the guard**

Add optional `tripRequestStatus` and `bookingStatus` to `shouldEnqueuePaidFollowup`. Return false for `abandoned`, `expired`, or booking `cancelled` before the existing checks. In `confirmPaymentByCrqid`, load the trip status (through the quote for a token, through the booking for a balance) and the booking status, and pass them in. Do this before inserting `finalize_booking` or `complete_balance_payment`.

- [ ] **Step 4: Implement cancel**

`POST /api/guest-trip/cancel` finds the trip by an allowed `session_id`. Set `trip_requests.status` to `abandoned`. If a booking exists, set `bookings.status` to `cancelled` and `cancelled_at` to now. Set open token and balance intents (`pending` or `sent`) to `expired`. Delete that trip’s `guest_trip_sessions` rows. Return `{ ok: true }` even when the trip was already abandoned.

The Cancel button calls it, then clears the hook snapshot, calls `resetClientSessionId()`, and `flow.clearBooking()` so the home screen is shown. Profile → clear booking calls this same cancel route before it resets the tab. A client-only clear would leave the phone blocked, which breaks the testing loop.

Before `handleSendTokenPaymentLink`, `handleSendBalancePayment`, and `assignDriverToBooking` send or attach anything, return without sending when the trip status is `abandoned` or `expired`, or the booking status is `cancelled`. An old WhatsApp Select, pay tap, or driver assignment for that trip must not open a payment or message anyone on the new trip. A vendor message already sent stays sent.

On `/pay/token/[crqid]`, when the trip is abandoned or expired, the page says `This trip is closed.` and links to `/?continue=1`. It does not offer Pay.

- [ ] **Step 5: Run the payment-report test and check cancel**

Run: `npx --yes tsx --conditions=react-server --test lib/whatsapp/paymentReport.test.ts`

Expected: PASS

Then cancel a trip after the token is paid, confirm home is shown, start another trip on the same phone, and confirm a repeated confirm call for the old crqid does not create a driver step on the new trip.

- [ ] **Step 6: Commit**

```bash
git add app/api/guest-trip/cancel lib/whatsapp/paymentReport.ts lib/whatsapp/paymentReport.test.ts lib/whatsapp/webhook/processWhatsAppWebhook.ts lib/whatsapp/sendTokenPaymentLink.ts lib/whatsapp/sendBalancePaymentLink.ts lib/whatsapp/assignDriverToBooking.ts app/pay/token features/guest-trip features/booking-request
git commit -m "feat(guest-trip): cancel a trip and ignore a late payment webhook"
```

---

### Task 9: Keep the visual-companion session out of git

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Ignore `.superpowers/`**

Add a line `.superpowers/` to `.gitignore`. That directory holds the brainstorm server key.

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore local brainstorm session files"
```

---

## Spec coverage

Each requirement in `docs/superpowers/specs/2026-09-29-website-trip-booking-design.md` is a task above.

- Trip start plus the quote template, side by side: existing OTP enqueue, Task 4 screen.
- No operators matched: the existing form error stays. No trip screen and no WhatsApp template. Task 4.
- Guest steps and copy: Task 3 builds the body. One operator uses `quote_single_v1`. Two or three use `quote_choice_v1`. Task 4 renders it. A cancelled trip shows Home.
- Same-tab refresh without OTP, and no second quote poll: Task 4.
- New visit from the home screen, second device without kicking the first tab off, and “already in progress”: Task 7. `guest_trip_sessions` keeps every verified tab.
- One in-progress trip, tested by Cancel or Profile clear: Tasks 1, 7, and 8.
- Select enqueues `send_token_payment_link`, including when WhatsApp chose first or both channels choose at once: Task 5. The earliest token intent is kept. The second tab is allowed through `guest_trip_sessions`. The site lists only the operators WhatsApp sent, at most 3, lowest first.
- Pay, abandoned or expired checkout, slow webhook, and Cashfree already paid: Tasks 2 and 6. A slow return stays on the lock or balance body with Pay hidden. If Cashfree is already paid and our row is not, the screen shows token received or driver contact and does not mark the intent paid. A missing balance intent is created on the server.
- Phone.Email return uses the resumed trip id: Task 7.
- WhatsApp footer lines and no mock-chat payment: Tasks 3 and 4.
- Driver phone only after the balance: Task 3.
- Ride-group link when the invite exists: Task 3 and Task 4.
- Quote or lock WhatsApp send fails: the site still renders the step. Quote sends retry through the existing job queue. The lock send is retried once in Task 5.
- Network loss keeps the last step: Task 4.
- Cancel, a late webhook, and old WhatsApp Select, pay, or driver-assign buttons: Task 8. The pay page says the trip is closed.
- Vendor messages, reminders, check-in, review, trip list, and a login cookie: not in this plan.
