# Kashmir BnB Cabs — Engineering Plan (Cursor Context Doc)
Stack: Next.js (App Router) + Supabase (Postgres/Auth/Realtime/Storage) + WhatsApp Cloud API (Meta) + SMS/Email fallback

This document is the single source of truth for implementing the "algorithmic quote engine + WhatsApp negotiation + booking confirmation" flow. It is written to be pasted into Cursor as project context so the AI agent can generate code consistent with this architecture.

---

## 1. Product Summary

We do NOT ping vendors live over WhatsApp for every quote request. Instead:

1. Vendors pre-configure quote bands (min/max first-quote price) per vehicle-config combination (vehicle type + model + pax capacity + trip days + season quarter).
2. When a customer submits a trip request, our backend algorithm matches the request against configured vendor quote bands instantly (no outbound vendor message yet).
3. UI shows a theatrical "requesting quotes" animation (fake-live, but backed by real matched data) for a few seconds.
4. Mid-animation, we gate progress behind a phone OTP registration modal.
5. After OTP verification, we send the matched quotes to the customer via WhatsApp (fallback SMS/Email), always leading with each vendor's MAX (first) quote, lowest-max highlighted.
6. Customer can (a) Book at quoted price, (b) Pay Rs 99 to lock, or (c) Negotiate — which deducts a randomized, config-bounded discount from the next quote.
7. On booking commit, we notify the winning vendor over WhatsApp asking them to reply with driver+vehicle details in a structured format.
8. Vendor reply is parsed (regex/LLM-assisted) and pushed back to the customer as a branded confirmation card with a stock car photo.
9. Lifecycle WhatsApp touchpoints continue through the trip (day-1 check-in, mid-trip wellness check for multi-day trips, post-trip review request).
10. All inbound WhatsApp replies (buttons + free text) are routed through one webhook, mapped to a booking state machine, and drive backend field updates.

---

## 2. High-Level Architecture

```
┌─────────────────┐        ┌──────────────────────┐        ┌────────────────────┐
│   Next.js Web    │──REST─▶│  Supabase Postgres    │◀──────▶│  Edge Functions /   │
│  (customer UI)   │        │  + RLS + Realtime      │        │  Cron Jobs (Deno)   │
└─────────────────┘        └──────────────────────┘        └────────────────────┘
        │                                                         │
        │  OTP (Supabase Auth phone / MSG91)                      │
        ▼                                                         ▼
┌─────────────────┐                                     ┌────────────────────┐
│  Quote Engine    │────────────────────────────────────▶│ WhatsApp Cloud API  │
│  (Edge Function) │        outbound templates           │ (Meta Graph API)    │
└─────────────────┘                                     └────────────────────┘
                                                                   │
                                                     inbound webhook (button/text)
                                                                   ▼
                                                         ┌────────────────────┐
                                                         │ Webhook Handler     │
                                                         │ (Next.js API route  │
                                                         │  or Edge Function)  │
                                                         └────────────────────┘
                                                                   │
                                                       writes booking state, triggers
                                                       next message via job queue
```

Key principle: **No outbound vendor "are you available" ping at quote-request time.** Vendors are only contacted post-booking-commit (driver attach) — this is what keeps the "requesting quotes" UX fast and fully backend-computed.

---

## 3. Core Domain Concepts

### 3.1 Quote Band Configuration (Vendor Rate Cards)
A vendor defines rate bands keyed by:
- `vehicle_type` (sedan, suv, tempo, etc.)
- `vehicle_model` (Swift Dzire, Toyota Etios, Innova Crysta, etc.) — optional granularity
- `pax_min` / `pax_max` (capacity bracket this band applies to)
- `trip_days_min` / `trip_days_max`
- `season_quarter` (Q1/Q2/Q3/Q4 or custom peak/off-peak tags)
- `min_quote` (floor — never quote below this)
- `max_quote` (ceiling — always the FIRST quote shown to customer)
- `negotiation_step_min` / `negotiation_step_max` (bounds for randomized discount per negotiation round)
- `max_negotiation_rounds` (e.g., 3 — after which floor price is shown as final)

This is fully data-driven — no hardcoded logic per vendor. New vendors just insert new rate_band rows.

### 3.2 Matching Algorithm
Given a request `{vehicle_type_preference, pax, days, date}`:
1. Resolve `season_quarter` from `date`.
2. Query `vendor_rate_bands` where `pax` falls within `[pax_min, pax_max]`, `days` within `[trip_days_min, trip_days_max]`, `season_quarter` matches (or `season_quarter IS NULL` = applies year-round), and vendor is `active`.
3. If `vehicle_type_preference` insufficient for pax (e.g., 7 pax + sedan selected), also compute the "smart recommendation" (see §3.3) by checking SUV/tempo bands for the same pax count and comparing `max_quote` economics (1×SUV vs 2×sedan cost).
4. Rank matched vendor bands by `max_quote` ascending — but for the initial WhatsApp message, we always list each vendor's `max_quote` first (per spec), just sorted so the cheapest max_quote is visually highlighted/flagged as "Best Price".
5. Persist a `quote_snapshot` row per matched vendor per booking request — this snapshot freezes the numbers shown to the customer (in case rate cards change later, the quote already sent stays consistent).

### 3.3 Vehicle Recommendation Logic
```
if requested_vehicle_type == 'sedan' and pax > sedan_capacity (e.g. 4):
    n_sedans = ceil(pax / sedan_capacity)
    sedan_total_cost = n_sedans * avg_matched_sedan_max_quote
    suv_bands = fetch bands where vehicle_type = 'suv' and pax_max >= pax
    if suv_bands exist:
        suv_cost = min(suv_band.max_quote for matched suv bands)
        if suv_cost < sedan_total_cost:
            emit recommendation: "1 SUV recommended — ₹{suv_cost} vs ₹{sedan_total_cost} for {n_sedans} sedans"
```
This recommendation is computed server-side and returned as part of the trip-request response payload — the frontend just renders it, no client-side math.

### 3.4 Negotiation Step Algorithm
When customer taps "Negotiate", backend computes the next quote:
```
current_quote = last_quote_shown_to_customer
band = vendor_rate_band for this quote_snapshot

if negotiation_round >= band.max_negotiation_rounds:
    return band.min_quote as FINAL (no further negotiation allowed)

step = random_uniform(band.negotiation_step_min, band.negotiation_step_max)
next_quote = max(current_quote - step, band.min_quote)

# Round to nearest 10 or 50 for realism
next_quote = round_to_nearest(next_quote, 10)

negotiation_round += 1
persist to quote_snapshot.negotiation_history (jsonb array)
```
Randomizing the step (bounded, e.g., 50–150) prevents customers from reverse-engineering a fixed discount pattern, per your requirement. Store every step in `negotiation_history` for audit and future ML-based dynamic pricing.

### 3.5 Booking Lock Options
- **Full booking**: customer commits to `final_quote`, payment_status → `token_paid` or `fully_paid` based on your payment policy toggle.
- **Pay ₹99 to lock**: minimum viable booking — creates the booking row immediately with `payment_status = 'token_paid'`, `final_quote` still pending full settlement; balance collected later (cash to driver, or follow-up payment link).

Both buttons on WhatsApp map to distinct `payload` values so the webhook can branch cleanly (see §6).

---

## 4. Database Schema (extends prior production schema)

```sql
-- ================= RATE CONFIGURATION =================

create type season_quarter as enum ('Q1','Q2','Q3','Q4','PEAK','OFF_PEAK','ALL_YEAR');

create table public.vendor_rate_bands (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  vehicle_type_id bigint not null references public.vehicle_types(id),
  vehicle_model text,                     -- 'Swift Dzire', 'Toyota Etios', null = any model of this type
  pax_min int not null,
  pax_max int not null,
  trip_days_min int not null default 1,
  trip_days_max int not null default 1,
  season_quarter season_quarter not null default 'ALL_YEAR',
  min_quote numeric(12,2) not null,
  max_quote numeric(12,2) not null,
  negotiation_step_min numeric(12,2) not null default 50,
  negotiation_step_max numeric(12,2) not null default 150,
  max_negotiation_rounds int not null default 3,
  is_active boolean not null default true,
  priority int not null default 100,      -- lower = preferred in tie-break ranking
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_range check (min_quote <= max_quote),
  constraint valid_pax check (pax_min <= pax_max),
  constraint valid_days check (trip_days_min <= trip_days_max)
);

create index idx_rate_bands_lookup
  on public.vendor_rate_bands (vehicle_type_id, pax_min, pax_max, trip_days_min, trip_days_max, season_quarter)
  where is_active = true;

-- ================= TRIP REQUEST (pre-registration) =================

create table public.trip_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,               -- anon browser session before OTP verification
  tourist_id uuid references public.tourists(id),  -- nullable until OTP verified
  pickup_location text,
  drop_location text,
  trip_start_date date not null,
  trip_days int not null default 1,
  pax_count int not null,
  requested_vehicle_type_id bigint references public.vehicle_types(id),
  recommended_vehicle_type_id bigint references public.vehicle_types(id),
  recommendation_reason text,
  status text not null default 'matching', -- matching, quotes_ready, otp_pending, quotes_sent, negotiating, booked, expired, abandoned
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_trip_requests_session on public.trip_requests(session_id);
create index idx_trip_requests_tourist on public.trip_requests(tourist_id);

-- ================= QUOTE SNAPSHOTS (frozen per request) =================

create type quote_channel as enum ('whatsapp','sms','email');
create type quote_snapshot_status as enum (
  'pending_send','sent','viewed','negotiating','finalized','expired','lost'
);

create table public.quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  trip_request_id uuid not null references public.trip_requests(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  vendor_rate_band_id uuid not null references public.vendor_rate_bands(id),
  vehicle_type_id bigint not null references public.vehicle_types(id),
  initial_quote numeric(12,2) not null,     -- = band.max_quote at time of match (frozen)
  min_quote_floor numeric(12,2) not null,   -- = band.min_quote (frozen)
  current_quote numeric(12,2) not null,     -- updates as negotiation proceeds
  negotiation_round int not null default 0,
  negotiation_history jsonb not null default '[]', -- [{round,prev,next,step,at}]
  is_best_price boolean not null default false,     -- lowest initial_quote among snapshot set
  status quote_snapshot_status not null default 'pending_send',
  sent_channel quote_channel,
  wa_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_quote_snapshots_trip on public.quote_snapshots(trip_request_id);
create index idx_quote_snapshots_vendor on public.quote_snapshots(vendor_id);
create index idx_quote_snapshots_status on public.quote_snapshots(status);

-- ================= OTP / REGISTRATION =================

create table public.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  phone_e164 text not null,
  otp_code_hash text not null,
  channel text not null default 'sms',   -- sms, whatsapp
  attempts int not null default 0,
  verified boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index idx_otp_session on public.otp_verifications(session_id);
create index idx_otp_phone on public.otp_verifications(phone_e164);

-- ================= BOOKINGS (extends earlier schema) =================
-- reuse booking_status enum from earlier plan; extend with negotiation-aware states

alter type booking_status add value if not exists 'quote_negotiating';
alter type booking_status add value if not exists 'token_locked';

alter table public.bookings
  add column if not exists trip_request_id uuid references public.trip_requests(id),
  add column if not exists winning_quote_snapshot_id uuid references public.quote_snapshots(id),
  add column if not exists lock_type text,          -- 'full_payment','token_99'
  add column if not exists final_quote numeric(12,2);

-- ================= VENDOR DRIVER-DETAIL SUBMISSION =================

create table public.driver_detail_submissions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  raw_message_text text not null,
  parsed_driver_name text,
  parsed_driver_phone text,
  parsed_vehicle_number text,
  parsed_vehicle_model text,
  parsed_vehicle_type text,
  parse_status text not null default 'pending', -- pending, parsed_ok, parse_failed, ops_corrected
  wa_message_id text,
  received_at timestamptz not null default now(),
  parsed_at timestamptz
);

-- ================= WHATSAPP CONVERSATION LOG (extends earlier) =================
-- reuse whatsapp_message_log from prior schema; add columns:

alter table public.whatsapp_message_log
  add column if not exists trip_request_id uuid references public.trip_requests(id),
  add column if not exists quote_snapshot_id uuid references public.quote_snapshots(id),
  add column if not exists button_payload text,
  add column if not exists interaction_type text; -- button_click, free_text, list_reply

-- ================= LIFECYCLE TOUCHPOINTS =================

create type lifecycle_event_type as enum (
  'day1_checkin','midtrip_wellness','post_trip_review','driver_assigned_notice','pre_pickup_reminder'
);

create table public.booking_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type lifecycle_event_type not null,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  customer_response text,
  response_at timestamptz,
  status text not null default 'scheduled', -- scheduled, sent, responded, skipped, failed
  created_at timestamptz not null default now()
);

create index idx_lifecycle_booking on public.booking_lifecycle_events(booking_id);
create index idx_lifecycle_scheduled on public.booking_lifecycle_events(scheduled_at) where status = 'scheduled';
```

---

## 5. Trip Request → Quote → OTP Flow (Sequence)

```
1. POST /api/trip-requests
   body: { pickup, drop, date, days, pax, vehicle_type_preference, session_id }
   → Edge Function: match_vendor_rate_bands()
   → creates trip_request row (status=matching)
   → creates quote_snapshot rows (status=pending_send) for each matched vendor
   → computes recommendation (§3.3) if applicable
   → returns: { trip_request_id, recommendation, matched_vendor_count }
   (No WhatsApp sent yet — frontend starts its animated "checking vendors" UI using
    matched_vendor_count to drive per-vendor progress states client-side.)

2. Frontend shows sequential "vendor checking" animation (client-side timers,
   using the already-known matched_vendor_count — NOT waiting on real vendor replies).

3. After ~4-6s (config: QUOTE_REVEAL_DELAY_MS), frontend shows OTP modal.

4. POST /api/otp/send { session_id, phone }
   → generates 6-digit OTP, hashes + stores in otp_verifications
   → sends via WhatsApp auth template (fallback SMS via MSG91/Twilio)

5. POST /api/otp/verify { session_id, phone, otp }
   → validates, creates/links tourists row, links trip_request.tourist_id
   → triggers send_quotes_job (async)

6. send_quotes_job:
   → for each quote_snapshot (status=pending_send):
       - mark is_best_price on the snapshot with lowest initial_quote
       - render WhatsApp interactive template (see §6.1)
       - send via WhatsApp Cloud API
       - on success: status → 'sent', log to whatsapp_message_log
       - on failure (after retry): fallback to SMS, then Email
   → trip_request.status → 'quotes_sent'
```

Why compute quotes before OTP: this lets the animation be instant and deterministic (no vendor-side latency), while OTP-gating ensures we don't spend WhatsApp template credits on unverified numbers.

---

## 6. WhatsApp Message Design

### 6.1 Quote Message (per vendor, or consolidated single message)

Recommendation: **one consolidated message** listing all matched vendors, cheapest highlighted, rather than N separate messages (better CX, fewer template sends).

Template structure (WhatsApp Interactive List or multiple Quick Reply buttons):
```
Header: Your Kashmir Cab Quotes Are In 🚖
Body:
  ⭐ Best Price — Vendor A: ₹2,500/day (Sedan)
  Vendor B: ₹2,600/day (Sedan)
  Vendor C: ₹3,500/day (SUV)

  Prices shown are opening quotes. You can negotiate.
Buttons (max 3 per WhatsApp Cloud API constraint):
  [Book Best Price]   payload: BOOK_FULL::{quote_snapshot_id}
  [Negotiate]          payload: NEGOTIATE::{quote_snapshot_id}
  [Pay ₹99 to Lock]    payload: BOOK_TOKEN::{quote_snapshot_id}
```
Note: WhatsApp Cloud API quick-reply buttons are capped at 3 per message and ~20 characters per label — plan copy accordingly. If more than 3 vendors need individual action rows, use a WhatsApp **List Message** (single message, multiple selectable rows) instead of stacking multiple button messages.

### 6.2 Negotiation Response Message
```
Body: Here's our next offer: ₹2,420/day (was ₹2,500)
Buttons:
  [Book This Price]   payload: BOOK_FULL::{quote_snapshot_id}
  [Negotiate Again]   payload: NEGOTIATE::{quote_snapshot_id}
  [Pay ₹99 to Lock]   payload: BOOK_TOKEN::{quote_snapshot_id}
```
If `negotiation_round >= max_negotiation_rounds`:
```
Body: This is our best possible price: ₹2,300/day. Final offer.
Buttons:
  [Book Now]           payload: BOOK_FULL::{quote_snapshot_id}
  [Pay ₹99 to Lock]    payload: BOOK_TOKEN::{quote_snapshot_id}
```

### 6.3 Vendor Notification (post-booking-commit)
Sent to vendor's registered WhatsApp number:
```
Body: New booking confirmed 🎉
  Route: Srinagar → Pahalgam
  Date: 14 Aug, 3 days
  Pax: 4 | Vehicle: Sedan
  Price: ₹2,420/day

Reply in this format to assign driver:
DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>

Example:
DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire
```
This structured free-text format is parsed by the webhook handler (§7.3) using a strict delimiter regex, with an ops-review fallback queue for malformed replies.

### 6.4 Customer Confirmation Card (after driver parsed)
```
Header: [Vendor Logo] Your Cab Is Confirmed ✅
Image: stock photo matching parsed vehicle_type
Body:
  Driver: Bilal Ahmed
  Vehicle: Swift Dzire (JK01AB1234)
  Pickup: 14 Aug, 8:00 AM — Srinagar Airport
  Vendor: [Vendor Name]
```

### 6.5 Lifecycle Messages
- **Pre-pickup reminder** (evening before pickup day): confirms driver/vehicle again + support contact.
- **Day-1 check-in** (morning of pickup): "How was your pickup?" with Yes/Report Issue buttons.
- **Mid-trip wellness check** (for trip_days >= 3, sent on day 2): "Everything going smoothly?" with Yes/Need Help buttons — button click routes to ops alert if "Need Help".
- **Post-trip review request** (day after trip ends): star rating via list message + optional free-text comment.

All scheduled via `booking_lifecycle_events` rows created at booking-confirmation time, processed by a cron-triggered Edge Function every 15 minutes that sends any event where `scheduled_at <= now() and status = 'scheduled'`.

---

## 7. Webhook Handler Design (Inbound WhatsApp)

Single endpoint: `POST /api/whatsapp/webhook`

### 7.1 Verification
Meta requires a `GET` challenge-response verification on setup, and signs inbound `POST` payloads with `X-Hub-Signature-256` — verify this HMAC against your app secret before processing, to prevent spoofed webhook calls.

### 7.2 Interactive Button Replies
Inbound payload contains `interactive.button_reply.id` — this is our `payload` string (e.g., `BOOK_FULL::<uuid>`). Parse action + entity id, then branch:

```
switch (action) {
  case 'BOOK_FULL':
    finalizeBooking({ quote_snapshot_id, lock_type: 'full_payment' })
  case 'BOOK_TOKEN':
    finalizeBooking({ quote_snapshot_id, lock_type: 'token_99' })
  case 'NEGOTIATE':
    computeNextQuote({ quote_snapshot_id })  // §3.4
    sendNegotiationMessage(...)
  case 'CHECKIN_OK':
    updateLifecycleEvent({ event_id, response: 'ok' })
  case 'CHECKIN_HELP':
    updateLifecycleEvent({ event_id, response: 'help_requested' })
    alertOpsTeam(...)
  case 'RATE_1'..'RATE_5':
    recordReview({ booking_id, rating })
}
```

### 7.3 Free-Text Vendor Driver-Detail Parsing
Match against strict pattern:
```
/^DRIVER:\s*([^|]+)\|\s*(\+?\d{10,13})\|\s*([A-Z0-9\- ]+)\|\s*(.+)$/i
```
If match fails, insert into `driver_detail_submissions` with `parse_status = 'parse_failed'` and notify ops via internal Slack/WhatsApp alert for manual entry — never block the customer experience on a parsing failure.

### 7.4 Idempotency
Every inbound webhook event includes a unique `message_id` from Meta. Store processed `wa_message_id`s in a dedupe table (or unique constraint on `whatsapp_message_log.wa_message_id`) to guard against Meta's at-least-once delivery retries.

---

## 8. State Machine (Trip Request → Booking)

```
trip_request.status:
  matching → quotes_ready → otp_pending → quotes_sent → negotiating → booked
                                                     ↘ expired (no response in 24-48h)

booking.status (extends earlier production enum):
  draft → payment_pending → token_locked / fully_paid
        → vendor_confirming → vendor_confirmed
        → driver_attach_pending → driver_attached
        → ready_for_pickup → in_trip → completed
        → (any point) cancelled / refund_pending / refunded
```

`quote_snapshot.status`: `pending_send → sent → viewed → negotiating → finalized / expired / lost`  
("lost" = another vendor's snapshot was chosen for the same trip_request — auto-set on booking commit for all sibling snapshots.)

---

## 9. Job Queue & Scheduling

Use Supabase Edge Functions + `pg_cron` (or a lightweight external scheduler like Trigger.dev / QStash) for:

- `send_quotes_job` — triggered post-OTP-verify (near-immediate, queued not synchronous, to avoid blocking the HTTP response).
- `expire_stale_quotes_job` — cron every hour; marks `quote_snapshots` older than 48h with no response as `expired`.
- `lifecycle_dispatch_job` — cron every 15 min; sends due `booking_lifecycle_events`.
- `vendor_reply_timeout_job` — cron every 10 min; if vendor hasn't sent driver details within SLA (e.g., 30 min for airport pickups, 2h for advance bookings), escalate to ops via internal alert + optionally auto-call fallback vendor logic.

Recommend **QStash or Trigger.dev over raw pg_cron** for anything involving external API calls (WhatsApp), since pg_cron runs inside Postgres and isn't ideal for HTTP-heavy side effects — use pg_cron only to enqueue jobs into a `job_queue` table, and a separate worker (Edge Function or small Node worker) to process them with retries/backoff.

```sql
create table public.job_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null,
  status text not null default 'queued', -- queued, processing, done, failed
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_job_queue_pending on public.job_queue(status, run_after) where status = 'queued';
```

---

## 10. API Route Map (Next.js App Router)

```
POST   /api/trip-requests                 create + match
GET    /api/trip-requests/:id             poll status (or use Supabase Realtime subscription)
POST   /api/otp/send
POST   /api/otp/verify
POST   /api/quotes/:id/negotiate          (internal use / fallback if not via WhatsApp)
POST   /api/bookings/finalize             (internal use / fallback if not via WhatsApp)
POST   /api/whatsapp/webhook              (GET for verify challenge, POST for events)
POST   /api/vendor/rate-bands             CRUD for vendor rate configuration (admin/vendor panel later)
GET    /api/admin/trip-requests            ops dashboard
GET    /api/admin/bookings
POST   /api/admin/driver-details/:id/correct   manual fix for parse_failed submissions
```

Use Supabase Realtime on `trip_requests` and `bookings` tables so the frontend "checking vendors" and later "waiting for confirmation" screens update live without polling.

---

## 11. Security & Compliance Notes

- Verify Meta webhook signature (`X-Hub-Signature-256`) on every inbound request — reject unsigned/invalid payloads.
- Rate-limit `/api/otp/send` per phone number and per IP (e.g., 3 requests / 10 min) to prevent OTP-bombing abuse.
- Never expose `vendor_rate_bands.min_quote` or `negotiation_step_*` to the client — all negotiation math happens server-side only, in Edge Functions with `service_role` key, never in browser-exposed code.
- Store OTP as a salted hash, not plaintext; expire after 5–10 minutes; cap verification attempts (e.g., 5) before requiring a fresh OTP.
- Apply RLS on `tourists`, `bookings`, `trip_requests` — customers can only read their own rows (matched via `auth.uid()` if using Supabase Auth phone sign-in, or a signed session token if using a custom OTP flow).
- WhatsApp template messages must be pre-approved by Meta — plan template submission lead time (24–48h typical) into your rollout schedule; authentication templates (OTP) have a distinct approval category from utility/marketing templates.
- Log every outbound/inbound WhatsApp interaction (already modeled in `whatsapp_message_log`) for dispute resolution and analytics.

---

## 12. Scalability Considerations

- `vendor_rate_bands` lookups are read-heavy and low-latency-critical (blocks the "instant quote" UX) — keep the composite index in §4, and consider a materialized cache (Redis or Supabase Edge Function in-memory cache with short TTL) once vendor count grows past ~50.
- Decouple WhatsApp sending from the request/response cycle entirely — always via `job_queue`, never synchronous fetch-and-wait inside an API route, to avoid Vercel function timeouts and to allow retry/backoff on Meta API rate limits.
- Partition `whatsapp_message_log` and `booking_status_log` by month once volume grows, since these are append-only, high-volume audit tables.
- Design `vendor_rate_bands` matching as a pure SQL query (no app-layer loops) so it scales with Postgres query planning rather than N+1 application logic.
- Keep the negotiation algorithm stateless per-request (reads current snapshot, computes next value, writes) — this avoids race conditions if a customer double-taps "Negotiate" (guard with a DB-level `select ... for update` or an idempotency key derived from `wa_message_id`).

---

## 13. Build Order (Recommended Sprints)

1. **Sprint 1** — Schema migration (all tables above), vendor rate-band admin CRUD (basic internal tool, no auth polish yet).
2. **Sprint 2** — Trip request API + matching algorithm + recommendation logic (§3.2, §3.3), unit-tested with fixture rate bands.
3. **Sprint 3** — Frontend hero + trip request flow + fake-live "checking vendors" animation wired to real matched_vendor_count.
4. **Sprint 4** — OTP send/verify (WhatsApp auth template + SMS fallback), session-to-tourist linking.
5. **Sprint 5** — WhatsApp Cloud API integration: consolidated quote message, negotiation flow, webhook handler + signature verification.
6. **Sprint 6** — Booking finalize logic (full/token lock), vendor notification + structured driver-detail parsing + ops fallback queue.
7. **Sprint 7** — Confirmation card to customer, job_queue + cron workers, lifecycle event scheduling (day-1, mid-trip, review).
8. **Sprint 8** — Admin/ops dashboard (trip requests, bookings, parse_failed queue, vendor rate-band management), analytics on negotiation conversion.

---

## 14. Open Config Flags (put in a `system_config` table or env)

- `QUOTE_REVEAL_DELAY_MS` (default 4500)
- `OTP_EXPIRY_SECONDS` (default 300)
- `OTP_MAX_ATTEMPTS` (default 5)
- `QUOTE_EXPIRY_HOURS` (default 48)
- `DEFAULT_NEGOTIATION_STEP_MIN` / `MAX`
- `TOKEN_LOCK_AMOUNT` (default 99)
- `VENDOR_DRIVER_DETAIL_SLA_MINUTES` (default 30 for same-day, 120 for advance bookings)
- `MIDTRIP_WELLNESS_MIN_DAYS` (default 3 — only trigger for trips of 3+ days)
