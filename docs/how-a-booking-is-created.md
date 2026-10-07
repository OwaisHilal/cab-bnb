# How a booking is created

This is the logic behind a guest booking a cab in the app: what the guest types in, how operators are matched, what gets saved at each step, and the moment a real `bookings` row is created.

A booking is not created when the guest taps “get quotes.” That tap creates a **trip request** and a set of **quote snapshots**. The **booking** row is created later, only after the guest pays the ₹99 token (or a full-payment lock). Everything before that is matching, verification, and a price offer.

---

## The three records

| Record | Table | When it appears | What it means |
| --- | --- | --- | --- |
| Trip request | `trip_requests` | Guest submits the form | “This person wants a trip with these dates, days, passengers, and vehicle.” |
| Quote snapshot | `quote_snapshots` | Immediately after matching, still on that same request | “This vendor’s opening price for that trip.” One row per matched vendor. |
| Booking | `bookings` | After the token (or full payment) is confirmed | “This guest locked this vendor at this price.” One winning quote. The other quotes are marked lost. |

The guest’s browser never talks to Supabase directly. Every write goes through a Next.js API route that uses the service-role client.

---

## End-to-end sequence

```text
Guest fills the form
        │
        ▼
POST /api/trip-requests
  1. Refuse a second open trip for this browser session
  2. Insert trip_requests (status = matching)
  3. Match vendor_rate_bands
  4. Insert quote_snapshots at each vendor's max_quote
  5. Set trip status = quotes_ready
        │
        ▼
App plays a short "checking vendors" animation, then asks for a phone number
        │
        ▼
OTP (or Phone.Email) verifies the phone
  • Upsert tourists by phone
  • Link tourist_id onto the trip request
  • Enqueue job: send_quotes
        │
        ▼
send_quotes loads the trip + quotes and WhatsApps up to 3 operators
  • quote status: pending_send → sent
  • trip status: quotes_sent
        │
        ▼
Guest picks an operator (WhatsApp button, or the in-app quote list)
  • Job: send_token_payment_link
  • Creates a ₹99 payment intent and a Cashfree order
        │
        ▼
Payment is confirmed (Cashfree webhook, or instant confirm in demo mode)
  • Job: finalize_booking
  • Postgres function finalize_quote_booking inserts the bookings row
        │
        ▼
Vendor is notified on WhatsApp, then assigns a driver
Guest later pays the remaining balance on that same booking
```

---

## 1. What the guest enters

The form lives in `features/booking-request`. The hook `useBookingFlow` keeps a draft:

| Field | Default | Limits | Sent to the server as |
| --- | --- | --- | --- |
| Trip length | 5 days | 1–14 days in the UI (API allows 1–30) | `trip_days` |
| Travellers | 2 | 1–20 | `pax_count` |
| Vehicle | Sedan | Sedan, SUV, Tempo Traveller | `requested_vehicle_type_id` |
| Start date | none until picked | A quick-pick chip, or a custom date | `trip_start_date` (ISO date) |

Vehicle ids are fixed to the seed order in `vehicle_types`: sedan = 1, SUV = 2, tempo = 3 (`VEHICLE_TYPE_IDS_BY_CODE` in `features/booking-request/constants.ts`). The app does not look these up from the database before submitting.

The browser also sends `session_id`, a random id stored in `sessionStorage` (`lib/utils/clientSession.ts`). That id is how we later find “this person’s trip” without a login.

Pickup and drop are columns on `trip_requests` and the API accepts them, but the current home form does not send them. They stay null unless some other caller supplies them. Quote messages still render a route line when those fields are present.

The start date is resolved in `resolveTripStartDate`: a custom date wins; otherwise the selected quick-pick chip is turned into an ISO date. If neither is set, the form stops and asks the guest to pick a date. Nothing is written yet.

---

## 2. Creating the trip request

`POST /api/trip-requests` (`app/api/trip-requests/route.ts`) does five things in order.

### 2.1 One open trip per session

Before inserting anything, the route loads every trip tied to this `session_id` (trips whose `session_id` matches, plus trips linked through `guest_trip_sessions`). `resolveKeeperTripId` picks the trip that should stay open.

If one already exists, the route returns that id with `existing: true` and does **not** match vendors again. The app shows “Only 1 booking is allowed for now” and opens the existing trip.

### 2.2 Insert the trip

```text
trip_requests
  session_id
  trip_start_date, trip_days, pax_count
  requested_vehicle_type_id
  pickup_location, drop_location   (null from the current form)
  status = 'matching'
  tourist_id = null                (phone is not known yet)
```

### 2.3 Match vendors

`matchVendorRateBands` in `lib/matching/matchVendorRateBands.ts` is the whole matching engine. It does not hardcode prices. Every price comes from `vendor_rate_bands`.

### 2.4 Write one quote per matched band

If at least one band matched, the route inserts `quote_snapshots`. The opening price is always the band’s `max_quote`. The band’s `min_quote` is stored as `min_quote_floor` for later negotiation and is not shown as the opening price.

```text
quote_snapshots
  trip_request_id
  vendor_id
  vendor_rate_band_id
  vehicle_type_id          (the type on the band, which is the requested type)
  initial_quote  = max_quote
  current_quote  = max_quote
  min_quote_floor = min_quote
  is_best_price  = true when this max_quote is the lowest among the matches
  status         = 'pending_send'
  negotiation_round = 0
```

If nothing matched, no quote rows are written. The trip is still moved to `quotes_ready`, and the API returns `matched_vendor_count: 0`. The app then tells the guest no verified operators are available and leaves them on the form.

### 2.5 Mark the trip ready

```text
trip_requests.status = 'quotes_ready'
recommended_vehicle_type_id = SUV id, or null
recommendation_reason       = the sentence from the matcher, or null
```

The response to the browser is only:

```json
{
  "trip_request_id": "...",
  "matched_vendor_count": 3,
  "recommendation": { "recommended_vehicle_type_id": 2, "reason": "..." }
}
```

Quote prices, vendor names, and the minimum price floor are not returned here. The “checking vendors” screen is an animation paced to `matched_vendor_count`. The names on that animation (`Nova Cabs`, and so on) are fixture labels in the client. The real vendor names are loaded later, when quotes are sent and when the guest trip is loaded.

---

## 3. How matching works

A rate band is one vendor’s price range for a slice of trips: vehicle type, passenger count, trip length, and season.

```text
vendor_rate_bands
  vendor_id
  vehicle_type_id
  pax_min, pax_max
  trip_days_min, trip_days_max
  season_quarter          Q1 | Q2 | Q3 | Q4 | PEAK | OFF_PEAK | ALL_YEAR
  min_quote, max_quote
  negotiation_step_min, negotiation_step_max
  max_negotiation_rounds
  is_active
```

`min_quote` must be less than or equal to `max_quote`. Inactive bands are ignored. The lookup index is `(vehicle_type_id, pax_min, pax_max, trip_days_min, trip_days_max, season_quarter)` where `is_active = true`.

### 3.1 Season

`resolveSeasonQuarter` maps the trip start date to a calendar quarter:

| Months (UTC) | Quarter |
| --- | --- |
| Jan–Mar | Q1 |
| Apr–Jun | Q2 |
| Jul–Sep | Q3 |
| Oct–Dec | Q4 |

`PEAK` and `OFF_PEAK` are not computed from the date. A band tagged `PEAK` or `OFF_PEAK` only matches if someone set the season that way by hand and the resolver happened to return that same value — which it never does today. Bands tagged `ALL_YEAR` always match, regardless of quarter.

### 3.2 The query

For the vehicle the guest asked for:

```text
vendor_rate_bands
  WHERE vehicle_type_id = requested id
    AND is_active = true
    AND vendor.status = 'active'          (inner join — paused or blacklisted vendors drop out)
    AND pax_min <= pax_count <= pax_max
    AND trip_days_min <= trip_days <= trip_days_max
    AND (season_quarter = this quarter OR season_quarter = 'ALL_YEAR')
  ORDER BY max_quote ASC
```

Each surviving row becomes a matched band: vendor id, vendor name, vehicle type, `max_quote`, `min_quote`.

Example. Guest asks for a sedan, 2 people, 5 days, starting in October (Q4).

| Band | Vendor | Pax | Days | Season | Active vendor? | Match? |
| --- | --- | --- | --- | --- | --- | --- |
| A | Nova | 1–4 | 3–7 | ALL_YEAR | active | yes |
| B | Ola | 1–4 | 1–5 | Q4 | active | yes |
| C | Valley | 5–8 | 3–7 | ALL_YEAR | active | no — 2 pax is outside 5–8 |
| D | Hill | 1–4 | 3–7 | Q1 | active | no — October is Q4, and this band is not ALL_YEAR |
| E | paused vendor | 1–4 | 3–7 | ALL_YEAR | paused | no |

Nova and Ola each get a quote snapshot. The cheaper `max_quote` is flagged `is_best_price`.

### 3.3 SUV recommendation

This is advice stored on the trip. It does not replace the quotes. The quotes are still for the vehicle the guest asked for.

The recommendation runs only when all of these are true:

1. The guest asked for a sedan.
2. The party is bigger than 4 (sedan seat capacity).
3. At least one sedan band matched.
4. At least one active SUV band matches the same pax, days, and season.
5. The cheapest SUV `max_quote` is lower than `ceil(pax / 4) × cheapest sedan max_quote`.

If 6 people need 2 sedans, and the cheapest sedan opening price is ₹10,000, two sedans cost ₹20,000. An SUV at ₹14,000 is recommended. An SUV at ₹21,000 is not. The reason string is saved on `trip_requests.recommendation_reason`.

The form also shows a simpler local hint when sedan is selected and the party is bigger than 4 and still fits in an SUV. That hint does not compare prices. The price comparison lives only on the server.

---

## 4. Phone verification links the guest

Quotes are not WhatsApped from `POST /api/trip-requests`. The phone is still unknown. After the short dispatch animation, the app asks for a mobile number.

`POST /api/otp/send` stores a hashed code on `otp_verifications` for this session and phone, and sends it by SMS (or WhatsApp if asked). Demo mode uses a fixed code.

`POST /api/otp/verify` checks the code, then `completePhoneVerification` (`lib/otp/completePhoneVerification.ts`) does the linking:

1. Load the trip and confirm `trip_requests.session_id` equals the session that verified. A valid OTP for one browser cannot be attached to someone else’s trip.
2. Upsert `tourists` on `phone_e164`. The same phone always maps to the same tourist.
3. If that tourist already has a different open trip, abandon this new request (`status = abandoned`) and point the session at the older trip. The app resumes that trip instead of starting a second one.
4. Otherwise set `trip_requests.tourist_id`.
5. If the trip is still `quotes_ready` or `otp_pending`, and no `send_quotes` job is already queued or running, move the trip to `otp_pending` and insert a `job_queue` row:

```text
job_type = send_quotes
payload  = { trip_request_id, verified_by: "otp_code" | "phone_email" }
```

6. Drain that job immediately so quotes go out without waiting for cron.
7. Remember the session in `guest_trip_sessions` so a later visit with the same browser can load the trip even if `session_id` on the row was the original one.

Phone.Email (the fallback when SMS cannot be sent) ends in the same `completePhoneVerification` function, so the two paths cannot drift.

---

## 5. Fetching details to send the quotes

`handleSendQuotes` calls `deliverQuoteWhatsApp`, which calls `buildQuoteDeliveryPayload`. That is the first time we assemble the message the guest actually sees.

Fetched in one trip query:

```text
trip_requests
  pickup_location, drop_location, trip_days, pax_count
  tourists.phone_e164
  vehicle_types.label          (the requested type)
```

Fetched from quotes still in `pending_send`, cheapest `current_quote` first:

```text
quote_snapshots
  id, current_quote, is_best_price
  vendors.business_name, vendors.reliability_score
  vehicle_types.label
```

If there is no verified phone, sending fails and the job can retry. If every quote is already `sent`, the job skips.

What the guest receives:

- **One operator:** a single-vendor message with name, price per day, and vehicle.
- **Two or more:** a choice message. The body uses the trip summary (days, passengers, vehicle, and route if pickup/drop exist). At most **3** operators are listed, lowest price first, with reliability score when the vendor has one.

On a successful send:

```text
those quote_snapshots: status = sent, sent_channel = whatsapp
trip_requests.status   = quotes_sent
whatsapp_message_log   gets a copy of the body
```

The in-app booking screen does not use that WhatsApp payload. It loads the same facts again through `GET` guest-trip (`loadGuestTrip`): trip, quotes, payment intents, and any booking, then derives which step to show.

---

## 6. Choosing an operator

Two doors lead to the same payment job.

**WhatsApp.** The quote message buttons carry the quote snapshot id. Tapping the token option is parsed as `book_token` and enqueues `send_token_payment_link` with that id. A negotiate tap enqueues `compute_negotiation` instead (see below). A full-payment tap enqueues `finalize_booking` with `lock_type = full_payment` and skips the ₹99 intent.

**In the app.** `POST /api/guest-trip/select` checks that this session may read the trip that owns the quote. If there is no open ₹99 intent yet, it enqueues the same `send_token_payment_link` job and drains it. If several token intents exist, only the earliest stays open; later ones are expired.

`handleSendTokenPaymentLink` (`lib/whatsapp/sendTokenPaymentLink.ts`) loads the chosen quote with its vendor, vehicle, trip, and tourist phone. It stops if the quote is already `finalized`, `lost`, or `expired`, or if the trip is abandoned or expired.

It then:

1. Builds the ₹99 message from the trip summary and `current_quote` (the live price, which may already have been negotiated down).
2. Inserts `whatsapp_payment_intents` if one is not already pending or sent for this quote:

```text
id / crqid          = new uuid (this is the id Cashfree and our webhooks share)
quote_snapshot_id
trip_request_id
tourist_id
vendor_id
customer_number     = phone without the leading +
amount_inr          = 99
status              = pending, then sent after WhatsApp accepts the message
purpose             = token_lock   (column default; the insert does not set it)
```

3. Creates a Cashfree order for that intent (`ensureCashfreeOrderForIntent`).
4. Sends the guest a WhatsApp button that opens `/pay/token/{crqid}`.

There is still no `bookings` row.

---

## 7. Negotiation, if the guest asks for a lower price

This is optional and happens before the booking exists. `compute_negotiation` (Postgres) locks the quote row so two taps cannot both apply a discount.

It reads the rate band that produced the quote and:

- If the round count is already at `max_negotiation_rounds`, the next price is `min_quote_floor` and the offer is final.
- Otherwise it subtracts a random step between `negotiation_step_min` and `negotiation_step_max`, never goes below `min_quote_floor`, and rounds to the nearest 10.

`current_quote` moves down. `initial_quote` stays the original `max_quote`. History is appended on the quote. Trip status moves from `quotes_sent` to `negotiating`, and is not moved backwards if the trip is already `booked`.

The price copied onto the booking later is this `current_quote`, not the original opening price.

---

## 8. Payment creates the booking

When Cashfree (or demo checkout) reports the ₹99 as paid, `confirmPaymentByCrqid` loads the payment intent by `crqid`.

- If the intent is a **balance** payment, the booking already exists. The follow-up job is `complete_balance_payment`, not a new booking.
- If the intent is the **token**, it resolves the `quote_snapshot_id` and, when that quote is still open, enqueues:

```text
job_type = finalize_booking
payload  = { quote_snapshot_id, lock_type: "token_99", ... }
```

`handleFinalizeBooking` calls the Postgres function `finalize_quote_booking`. The function is the only place that inserts `bookings` for this flow. It locks the quote row first.

Guards:

| Condition | Result |
| --- | --- |
| Unknown quote id | `quote_snapshot_not_found` |
| Quote already `finalized`, `lost`, or `expired` | `quote_snapshot_not_negotiable` |
| Trip has no `tourist_id` | `tourist_not_verified` |
| `lock_type` is not `token_99` or `full_payment` | `invalid_lock_type` |

Then, in one transaction:

1. Insert `bookings`. `booking_ref` is `BK-YYYYMMDD-` plus 5 random characters. A unique collision retries up to 5 times.
2. Set the chosen quote to `finalized`.
3. Set every other quote on the same trip to `lost` (unless it was already finalized or lost).
4. Set `trip_requests.status` to `booked`.
5. Enqueue jobs. For a token lock: `send_token_received_ack` and `notify_vendor_booking`. For full payment: `notify_vendor_booking` only.

### What is copied onto the booking

Nothing is re-matched at this point. The function copies fields it already has:

| Booking column | Source |
| --- | --- |
| `booking_ref` | Generated |
| `tourist_id` | `trip_requests.tourist_id` |
| `trip_request_id` | The trip |
| `winning_quote_snapshot_id` | The quote that was paid |
| `vendor_id` | That quote |
| `vehicle_type_id` | That quote |
| `final_quote` | That quote’s `current_quote` |
| `pickup_at` | `trip_start_date` |
| `trip_days`, `pax_count` | The trip |
| `status` | `vendor_confirming` |
| `payment_status` | `token_paid` for ₹99, `fully_paid` for a full lock |
| `lock_type` | `token_99` or `full_payment` |

Driver, vehicle registration, and the balance due are not known yet. Those land in later steps.

`POST /api/bookings/finalize` is the same function, called directly with a quote id and a lock type. The normal guest path reaches it through the payment job, not through that route.

---

## 9. After the booking exists

The booking row is the handoff to the vendor. Later jobs do not create another booking.

1. **Token received.** The guest gets a WhatsApp acknowledgement. The in-app step becomes `token_received` while `payment_status` is `token_paid` and no driver is attached.
2. **Vendor notify.** `notify_vendor_booking` loads the booking (guest, trip, quote, vehicle) and messages the vendor’s WhatsApp number.
3. **Driver.** The vendor replies with driver details, or uses the assign-driver page. The booking gains `driver_id` and a vehicle. Guest step becomes `balance`.
4. **Balance.** `send_balance_payment` computes the remaining amount from `final_quote` and the ₹99 already paid, and creates a second payment intent with `purpose = balance` and `booking_id` set. Paying it runs `complete_balance_payment`. It updates the existing booking. It does not insert a new one.
5. **Driver contact.** Once the balance is paid, the guest sees the driver’s name, phone, and vehicle.

Guest step is derived, not stored (`deriveGuestStep`):

```text
trip abandoned or expired          → closed
balance confirmed                  → driver_contact
driver assigned                    → balance
token intent paid                  → token_received
token intent pending or sent       → lock          (pay ₹99)
any open quotes                    → quotes
otherwise                          → quotes_waiting
```

---

## Status reference

### Trip request

```text
matching → quotes_ready → otp_pending → quotes_sent → negotiating → booked
                                                              ↘ expired
any early trip can also become abandoned
```

`negotiating` only happens if the guest asks for a lower price. A guest can go `quotes_sent` → `booked` directly.

### Quote snapshot

```text
pending_send → sent → viewed / negotiating → finalized
                                         ↘ lost      (a sibling quote won)
                                         ↘ expired
```

### Booking

Created already in `vendor_confirming`, with `payment_status` of `token_paid` or `fully_paid`. Later updates move it through driver assignment and completion. Cancelled trips are not reused to start a new token link.

---

## Where to read the code

| Step | File |
| --- | --- |
| Form state and submit | `features/booking-request/hooks/useBookingFlow.ts` |
| Create trip + quotes | `app/api/trip-requests/route.ts` |
| Match rate bands | `lib/matching/matchVendorRateBands.ts` |
| Season | `lib/matching/resolveSeasonQuarter.ts` |
| Verify phone and enqueue quotes | `lib/otp/completePhoneVerification.ts` |
| Build and send quote WhatsApp | `lib/whatsapp/buildQuoteDelivery.ts`, `lib/whatsapp/deliverQuoteWhatsApp.ts` |
| Guest picks a quote in the app | `lib/guest-trip/selectQuoteForGuest.ts` |
| WhatsApp button → job | `lib/whatsapp/webhook/enqueueWebhookAction.ts` |
| ₹99 intent + Cashfree order | `lib/whatsapp/sendTokenPaymentLink.ts` |
| Paid token → finalize job | `lib/whatsapp/webhook/processWhatsAppWebhook.ts` (`confirmPaymentByCrqid`) |
| Insert the booking | `finalize_quote_booking` in `supabase/migrations/20260910101009_pg_cron_edge_schedulers.sql` |
| Job wrapper around that function | `lib/whatsapp/finalizeBooking.ts` |
| Load what the booking screen shows | `lib/guest-trip/loadGuestTrip.ts` |
| Which screen step | `lib/guest-trip/deriveGuestStep.ts` |
| Tables | `supabase/migrations/20260810000100_0001_core_actors.sql` (vendors, vehicles, tourists) |
| | `20260810000200_0002_rate_bands.sql` |
| | `20260810000300_0003_trip_requests_and_quotes.sql` |
| | `20260810000500_0005_bookings.sql` |

---

## A walkthrough with numbers

Guest: 4 people, 5 days, sedan, start date 10 October, phone verified as `+9198…`.

1. Session `sess_abc` has no open trip. Insert trip `T1`, status `matching`.
2. October is Q4. Query returns three active sedan bands whose pax range includes 4 and whose day range includes 5, season Q4 or ALL_YEAR. Opening prices (each band’s `max_quote`): Nova ₹10,800, Ola ₹11,200, Valley ₹11,400.
3. Three `quote_snapshots` are inserted. Nova is `is_best_price` because ₹10,800 is the lowest. Floors (`min_quote`) are stored and not shown. Trip becomes `quotes_ready`. Response: `matched_vendor_count: 3`.
4. OTP succeeds. Tourist `U1` is upserted and linked. Job `send_quotes` runs.
5. WhatsApp lists the three operators, cheapest first. Quotes become `sent`. Trip becomes `quotes_sent`.
6. Guest taps Nova. A payment intent for ₹99 is created, tied to Nova’s quote snapshot. Cashfree order is created. Guest pays.
7. Webhook enqueues `finalize_booking` with Nova’s quote id and `lock_type = token_99`.
8. `finalize_quote_booking` inserts `BK-20261010-A1B2C`, vendor Nova, `final_quote = 10800`, `payment_status = token_paid`, `status = vendor_confirming`. Nova’s quote is `finalized`. Ola and Valley are `lost`. Trip `T1` is `booked`.
9. Nova is notified and later attaches a driver. The guest pays `10800 × 5 − 99` as the balance on that same booking.
