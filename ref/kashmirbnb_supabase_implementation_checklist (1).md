# Kashmir BnB Cabs — Supabase-First Implementation Checklist
Companion to: kashmirbnb_whatsapp_engineering_plan.md
Stack: Next.js (App Router) + Supabase (Postgres/Auth/Realtime/Storage/Edge Functions) + WhatsApp Cloud API

This is a build-order checklist with exact migration files, route handlers, and Edge Function responsibilities. Paste into Cursor as execution context.

---

## Migration File Naming Convention

Supabase CLI migrations: `supabase/migrations/<timestamp>_<name>.sql`
Apply in this exact numeric order (use sequential timestamps).

---

## PHASE 0 — Project Setup

### Checklist
- [ ] `supabase init` in project root
- [ ] Link project: `supabase link --project-ref <ref>`
- [ ] Enable extensions: `pgcrypto`, `pg_cron` (via Supabase dashboard → Database → Extensions)
- [ ] Set up `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `SMS_PROVIDER_API_KEY`, `EMAIL_PROVIDER_API_KEY`, `CRON_SECRET`
- [ ] Create `lib/supabase/server.ts` (service-role client, server-only) and `lib/supabase/client.ts` (anon client, browser-safe)
- [ ] Configure Vercel (or hosting) env vars mirroring `.env.local`, mark service role key as server-only secret

---

## PHASE 1 — Core Schema Migrations

### `0001_core_actors.sql`
```sql
create extension if not exists pgcrypto;

create table public.tourists (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone_e164 text not null unique,
  whatsapp_number text,
  email text,
  country_code text,
  preferred_currency text default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type vendor_onboarding_stage as enum ('whatsapp_only','hybrid','portal_active');
create type vendor_status as enum ('active','paused','blacklisted');

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  slug text unique,
  onboarding_stage vendor_onboarding_stage not null default 'whatsapp_only',
  status vendor_status not null default 'active',
  primary_city text,
  coverage_cities text[] not null default '{}',
  reliability_score numeric(4,2) not null default 3.00,
  whatsapp_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicle_types (
  id bigserial primary key,
  code text not null unique,
  label text not null,
  icon_key text not null,
  seat_capacity int not null,
  luggage_capacity int,
  sort_order int not null default 100,
  is_active boolean not null default true
);

insert into public.vehicle_types (code, label, icon_key, seat_capacity, sort_order) values
  ('sedan','Sedan','sedan',4,10),
  ('suv','SUV','suv',6,20),
  ('tempo','Tempo Traveller','tempo',12,30);
```
**Verify:** `select * from vehicle_types;` returns 3 rows.

### `0002_rate_bands.sql`
```sql
create type season_quarter as enum ('Q1','Q2','Q3','Q4','PEAK','OFF_PEAK','ALL_YEAR');

create table public.vendor_rate_bands (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  vehicle_type_id bigint not null references public.vehicle_types(id),
  vehicle_model text,
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
  priority int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_range check (min_quote <= max_quote),
  constraint valid_pax check (pax_min <= pax_max),
  constraint valid_days check (trip_days_min <= trip_days_max)
);

create index idx_rate_bands_lookup
  on public.vendor_rate_bands (vehicle_type_id, pax_min, pax_max, trip_days_min, trip_days_max, season_quarter)
  where is_active = true;
```
**Verify:** insert 2-3 fixture bands (Swift Dzire 4pax, Etios 2pax, SUV 6pax) and run a manual `select` matching pax=7.

### `0003_trip_requests_and_quotes.sql`
```sql
create table public.trip_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  tourist_id uuid references public.tourists(id),
  pickup_location text,
  drop_location text,
  trip_start_date date not null,
  trip_days int not null default 1,
  pax_count int not null,
  requested_vehicle_type_id bigint references public.vehicle_types(id),
  recommended_vehicle_type_id bigint references public.vehicle_types(id),
  recommendation_reason text,
  status text not null default 'matching',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_trip_requests_session on public.trip_requests(session_id);
create index idx_trip_requests_tourist on public.trip_requests(tourist_id);

create type quote_channel as enum ('whatsapp','sms','email');
create type quote_snapshot_status as enum ('pending_send','sent','viewed','negotiating','finalized','expired','lost');

create table public.quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  trip_request_id uuid not null references public.trip_requests(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  vendor_rate_band_id uuid not null references public.vendor_rate_bands(id),
  vehicle_type_id bigint not null references public.vehicle_types(id),
  initial_quote numeric(12,2) not null,
  min_quote_floor numeric(12,2) not null,
  current_quote numeric(12,2) not null,
  negotiation_round int not null default 0,
  negotiation_history jsonb not null default '[]',
  is_best_price boolean not null default false,
  status quote_snapshot_status not null default 'pending_send',
  sent_channel quote_channel,
  wa_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_quote_snapshots_trip on public.quote_snapshots(trip_request_id);
create index idx_quote_snapshots_vendor on public.quote_snapshots(vendor_id);
create index idx_quote_snapshots_status on public.quote_snapshots(status);
```
**Verify:** insert a fake trip_request + quote_snapshot manually, confirm FK integrity.

### `0004_otp.sql`
```sql
create table public.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  phone_e164 text not null,
  otp_code_hash text not null,
  channel text not null default 'sms',
  attempts int not null default 0,
  verified boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index idx_otp_session on public.otp_verifications(session_id);
create index idx_otp_phone on public.otp_verifications(phone_e164);
```
**Verify:** insert + expire test row, confirm expiry filtering works in a test query.

### `0005_bookings.sql`
```sql
create type booking_status as enum (
  'draft','payment_pending','token_locked','fully_paid',
  'vendor_confirming','vendor_confirmed',
  'driver_attach_pending','driver_attached',
  'ready_for_pickup','in_trip','completed',
  'cancelled','refund_pending','refunded',
  'quote_negotiating','no_response_exception'
);
create type payment_status as enum ('unpaid','token_paid','partially_paid','fully_paid','refund_pending','refunded','failed');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_ref text not null unique,
  tourist_id uuid not null references public.tourists(id),
  trip_request_id uuid references public.trip_requests(id),
  winning_quote_snapshot_id uuid references public.quote_snapshots(id),
  vendor_id uuid references public.vendors(id),
  vehicle_type_id bigint references public.vehicle_types(id),
  status booking_status not null default 'draft',
  payment_status payment_status not null default 'unpaid',
  lock_type text,
  final_quote numeric(12,2),
  pickup_at timestamptz not null,
  trip_days int not null default 1,
  pax_count int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz
);
create index idx_bookings_tourist on public.bookings(tourist_id);
create index idx_bookings_status on public.bookings(status);
create index idx_bookings_vendor on public.bookings(vendor_id);
```
**Verify:** create booking referencing a finalized quote_snapshot; confirm cascade behavior on tourist delete (should restrict, not cascade — no `on delete cascade` here intentionally).

### `0006_driver_details_and_messaging.sql`
```sql
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
  parse_status text not null default 'pending',
  wa_message_id text,
  received_at timestamptz not null default now(),
  parsed_at timestamptz
);

create table public.whatsapp_message_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  tourist_id uuid references public.tourists(id) on delete set null,
  trip_request_id uuid references public.trip_requests(id) on delete set null,
  quote_snapshot_id uuid references public.quote_snapshots(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound')),
  template_name text,
  body_snapshot text,
  button_payload text,
  interaction_type text,
  wa_message_id text unique,
  wa_status text,
  created_at timestamptz not null default now()
);
create index idx_wa_log_booking on public.whatsapp_message_log(booking_id, created_at desc);
create index idx_wa_log_vendor on public.whatsapp_message_log(vendor_id, created_at desc);
```
**Verify:** confirm `wa_message_id` unique constraint rejects duplicate webhook deliveries (idempotency test).

### `0007_lifecycle_and_jobs.sql`
```sql
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
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);
create index idx_lifecycle_booking on public.booking_lifecycle_events(booking_id);
create index idx_lifecycle_scheduled on public.booking_lifecycle_events(scheduled_at) where status = 'scheduled';

create table public.job_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null,
  status text not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_job_queue_pending on public.job_queue(status, run_after) where status = 'queued';
```
**Verify:** insert a job row with `run_after = now()`, confirm a worker query `where status='queued' and run_after <= now()` returns it.

### `0008_rls_policies.sql`
```sql
alter table public.tourists enable row level security;
alter table public.trip_requests enable row level security;
alter table public.bookings enable row level security;
alter table public.quote_snapshots enable row level security;

-- Service role bypasses RLS by default via service_role key — policies below are for
-- any future direct client (anon/authenticated) access, e.g. a customer "my bookings" page.

create policy "tourist reads own row"
  on public.tourists for select
  using (auth.uid()::text = id::text);

create policy "tourist reads own trip requests"
  on public.trip_requests for select
  using (tourist_id in (select id from public.tourists where auth.uid()::text = id::text));

create policy "tourist reads own bookings"
  on public.bookings for select
  using (tourist_id in (select id from public.tourists where auth.uid()::text = id::text));

create policy "tourist reads own quote snapshots"
  on public.quote_snapshots for select
  using (trip_request_id in (
    select id from public.trip_requests where tourist_id in (
      select id from public.tourists where auth.uid()::text = id::text
    )
  ));
```
**Note:** If not using Supabase Auth (custom OTP flow instead), skip `auth.uid()` policies and enforce access purely via signed session tokens validated in Next.js API routes using the service-role client. RLS becomes relevant later if you expose a public "my booking" page via Supabase client directly.

**Verify:** as anon key, confirm `select * from bookings` returns 0 rows without a matching session.

---

## PHASE 2 — Next.js Route Handlers (Build Order)

All routes under `app/api/`. Use service-role Supabase client server-side only.

### 2.1 `app/api/trip-requests/route.ts` (POST)
**Responsibility:** create trip_request, run matching algorithm, compute recommendation, create quote_snapshots, return summary (no WhatsApp send here).
```
POST body: { pickup, drop, trip_start_date, trip_days, pax_count, requested_vehicle_type_id, session_id }
→ insert trip_requests row
→ call matchVendorRateBands(pax, days, date, vehicle_type_id) [see Edge Function 3.1, can also be a plain server function initially]
→ compute recommendation if pax exceeds sedan capacity
→ insert quote_snapshots rows (status='pending_send')
→ mark best-price snapshot: is_best_price = true where initial_quote = min(initial_quote)
→ update trip_requests.status = 'quotes_ready'
→ return { trip_request_id, matched_vendor_count, recommendation }
```

### 2.2 `app/api/trip-requests/[id]/route.ts` (GET)
**Responsibility:** poll trip_request + quote_snapshots status (fallback if not using Realtime).

### 2.3 `app/api/otp/send/route.ts` (POST)
**Responsibility:** rate-limit check, generate OTP, hash + store, send via WhatsApp auth template with SMS fallback.
```
POST body: { session_id, phone_e164 }
→ rate limit: max 3 per 10 min per phone (query otp_verifications count)
→ generate 6-digit code
→ hash (bcrypt/argon2), insert otp_verifications row, expires_at = now() + 5min
→ send via WhatsApp Cloud API auth template
→ on failure: fallback to SMS provider
→ return { sent: true, channel }
```

### 2.4 `app/api/otp/verify/route.ts` (POST)
**Responsibility:** verify OTP, upsert tourist, link trip_request, enqueue quote-send job.
```
POST body: { session_id, phone_e164, otp_code }
→ fetch latest unexpired otp_verifications row for phone+session
→ compare hash, check attempts < max
→ on success: verified=true; upsert tourists row; update trip_requests.tourist_id
→ insert job_queue row { job_type: 'send_quotes', payload: { trip_request_id } }
→ update trip_requests.status = 'otp_pending' -> will become 'quotes_sent' once job runs
→ return { verified: true, trip_request_id }
```

### 2.5 `app/api/whatsapp/webhook/route.ts` (GET + POST)
**Responsibility:** Meta webhook verification (GET) + all inbound event processing (POST). This is the most important route — see Phase 3 for full branching logic.
```
GET: respond to hub.challenge if hub.verify_token matches WHATSAPP_VERIFY_TOKEN
POST:
  → verify X-Hub-Signature-256 HMAC against WHATSAPP_APP_SECRET
  → dedupe check on wa_message_id (unique constraint catch)
  → parse interactive.button_reply.id OR message.text.body
  → branch: BOOK_FULL | BOOK_TOKEN | NEGOTIATE | CHECKIN_OK | CHECKIN_HELP | RATE_1..5 | DRIVER: free-text
  → insert job_queue row per action (never process WhatsApp send synchronously inside webhook handler)
  → return 200 immediately (Meta requires fast ack, retries on timeout)
```

### 2.6 `app/api/admin/rate-bands/route.ts` (GET/POST/PATCH)
**Responsibility:** internal CRUD for vendor_rate_bands (basic admin tool, auth-gated).

### 2.7 `app/api/admin/driver-details/[id]/correct/route.ts` (PATCH)
**Responsibility:** ops manually corrects a `parse_failed` driver_detail_submissions row, triggers confirmation send job.

### 2.8 `app/api/cron/dispatch-jobs/route.ts` (POST, secured via `CRON_SECRET` header)
**Responsibility:** worker endpoint invoked by Vercel Cron or external scheduler every 1 min; pulls queued jobs from `job_queue`, executes side effects (WhatsApp sends), updates status/attempts.

---

## PHASE 3 — Supabase Edge Functions (Business Logic Core)

Edge Functions live in `supabase/functions/<name>/index.ts`. Use these instead of Next.js routes when logic must run close to the DB with service-role access and needs independent scaling/deploys.

### 3.1 `match-vendor-rate-bands`
**Responsibility:** pure matching algorithm (§3.2/3.3 from engineering plan).
```
Input: { pax_count, trip_days, trip_start_date, requested_vehicle_type_id }
Logic:
  1. resolve season_quarter from trip_start_date
  2. SQL: select * from vendor_rate_bands
     where vehicle_type_id = requested_vehicle_type_id (or all types if exploring recommendation)
       and pax_count between pax_min and pax_max
       and trip_days between trip_days_min and trip_days_max
       and (season_quarter = resolved or season_quarter = 'ALL_YEAR')
       and is_active = true
       and vendor_id in (select id from vendors where status = 'active')
  3. if requested type = sedan and pax_count > 4:
       compute n_sedans = ceil(pax/4); sedan_total = n_sedans * min(matched sedan max_quote)
       query suv bands similarly; compare; set recommendation
  4. return matched bands + recommendation
Called by: app/api/trip-requests POST route (via supabase.functions.invoke or direct SQL if colocated)
```

### 3.2 `send-quotes`
**Responsibility:** consumed by job_queue worker; renders consolidated WhatsApp message, sends via Cloud API, updates quote_snapshots + whatsapp_message_log, falls back to SMS/Email on failure.
```
Input: { trip_request_id }
Logic:
  1. fetch quote_snapshots where trip_request_id = X and status = 'pending_send'
  2. sort by initial_quote asc; mark lowest is_best_price = true
  3. render WhatsApp interactive/list message body
  4. POST to Graph API /PHONE_NUMBER_ID/messages
  5. on 200: update quote_snapshots.status='sent', wa_message_id, sent_channel='whatsapp'
     insert whatsapp_message_log (direction='outbound')
  6. on failure after N retries: fallback SMS (Twilio/MSG91), then Email; update sent_channel accordingly
  7. update trip_requests.status = 'quotes_sent'
```

### 3.3 `compute-negotiation`
**Responsibility:** randomized bounded decrement logic (§3.4).
```
Input: { quote_snapshot_id }
Logic:
  1. select ... for update on quote_snapshots row (lock against double-tap race)
  2. fetch vendor_rate_bands for negotiation_step_min/max, max_negotiation_rounds, min_quote
  3. if negotiation_round >= max_negotiation_rounds: return { next_quote: min_quote_floor, is_final: true }
  4. step = random_uniform(step_min, step_max); next = max(current_quote - step, min_quote_floor)
  5. round to nearest 10
  6. append to negotiation_history jsonb; increment negotiation_round; update current_quote
  7. return { next_quote, is_final: next_quote <= min_quote_floor }
Called by: webhook handler job for NEGOTIATE action
```

### 3.4 `finalize-booking`
**Responsibility:** commit booking, mark sibling snapshots lost, notify vendor.
```
Input: { quote_snapshot_id, lock_type }  // 'full_payment' | 'token_99'
Logic:
  1. fetch quote_snapshot + trip_request + vendor
  2. insert bookings row (status='vendor_confirming', payment_status based on lock_type, final_quote=current_quote)
  3. update quote_snapshots.status='finalized' for winner; 'lost' for all sibling snapshots of same trip_request_id
  4. insert job_queue row { job_type: 'notify_vendor_booking', payload: { booking_id } }
  5. return { booking_id, booking_ref }
```

### 3.5 `notify-vendor-booking`
**Responsibility:** send structured WhatsApp message to vendor asking for driver details; update booking.status='vendor_confirmed' pending reply, then 'driver_attach_pending'.

### 3.6 `parse-driver-details`
**Responsibility:** regex-parse inbound vendor free-text against `DRIVER: name | phone | vehicle_number | model` format.
```
Input: { booking_id, vendor_id, raw_message_text, wa_message_id }
Logic:
  1. regex match; on success: insert driver_detail_submissions (parse_status='parsed_ok')
     update bookings.status = 'driver_attached'
     insert job_queue { job_type: 'send-confirmation-card', payload: { booking_id } }
  2. on failure: insert driver_detail_submissions (parse_status='parse_failed')
     insert job_queue { job_type: 'alert-ops', payload: { booking_id, raw_message_text } }
```

### 3.7 `send-confirmation-card`
**Responsibility:** send branded WhatsApp confirmation (vendor logo, stock car photo by vehicle_type, driver+vehicle details) to customer; schedule lifecycle events.
```
Logic:
  1. fetch booking + driver_detail_submissions + vendor branding assets
  2. send WhatsApp image+text message to tourist
  3. insert booking_lifecycle_events rows:
     - pre_pickup_reminder: scheduled_at = pickup_at - 12h
     - day1_checkin: scheduled_at = pickup_at + 2h
     - midtrip_wellness: only if trip_days >= MIDTRIP_WELLNESS_MIN_DAYS, scheduled_at = pickup_at + 1.5 days
     - post_trip_review: scheduled_at = pickup_at + trip_days + 1 day
```

### 3.8 `dispatch-lifecycle-events` (cron-triggered)
**Responsibility:** runs every 15 min, sends any `booking_lifecycle_events` where `scheduled_at <= now()` and `status='scheduled'`.

### 3.9 `expire-stale-quotes` (cron-triggered)
**Responsibility:** runs hourly; marks `quote_snapshots` older than `QUOTE_EXPIRY_HOURS` with no response as `expired`; updates parent `trip_requests.status='expired'` if all snapshots expired.

### 3.10 `job-queue-worker` (cron-triggered, every 1 min)
**Responsibility:** central dispatcher — pulls `job_queue` rows where `status='queued' and run_after <= now()`, routes by `job_type` to the correct function above (send-quotes, compute-negotiation, finalize-booking, notify-vendor-booking, parse-driver-details, send-confirmation-card, alert-ops), handles retry/backoff on failure (`attempts += 1`, exponential `run_after` delay, `status='failed'` after `max_attempts`).

---

## PHASE 4 — Frontend Wiring (Next.js)

- [ ] Trip request form → POST `/api/trip-requests` → get `trip_request_id`
- [ ] "Checking vendors" animation screen: use `matched_vendor_count` from response to drive N sequential UI states (client-side timers only, no polling needed for this specific screen)
- [ ] After `QUOTE_REVEAL_DELAY_MS`, show OTP modal → POST `/api/otp/send`
- [ ] OTP input → POST `/api/otp/verify`
- [ ] Post-verify: subscribe to Supabase Realtime on `trip_requests:id=eq.<id>` and `quote_snapshots:trip_request_id=eq.<id>` to show live "Quotes sent to your WhatsApp" confirmation state
- [ ] Optional in-app fallback quote view (in case customer doesn't check WhatsApp) — read-only mirror of the same quote_snapshots data, with "Book" / "Negotiate" buttons calling internal fallback routes (§2 — negotiate/finalize) for parity

---

## PHASE 5 — Testing & Validation Gates (per phase, before moving on)

- [ ] Phase 1: all migrations apply cleanly on a fresh Supabase project (`supabase db reset` locally)
- [ ] Phase 1: fixture vendor + rate bands inserted; manual SQL match query returns expected rows for test pax/day combos (4pax/1day, 2pax/1day, 7pax/1day)
- [ ] Phase 2: `trip-requests` POST returns correct `matched_vendor_count` and recommendation for 7-pax sedan-preference test case
- [ ] Phase 2: OTP flow tested end-to-end with a real WhatsApp test number + SMS fallback forced by simulating API failure
- [ ] Phase 3: webhook signature verification rejects tampered payloads (test with wrong secret)
- [ ] Phase 3: double-tap on "Negotiate" button does not produce duplicate negotiation rounds (row-lock test)
- [ ] Phase 3: malformed vendor driver-detail reply correctly falls into `parse_failed` + ops alert, does not silently drop
- [ ] Phase 3: job_queue worker correctly retries failed WhatsApp sends and marks `failed` after max_attempts
- [ ] Phase 4: full happy path manually walked: trip request → OTP → quote received on real WhatsApp → negotiate once → book with token → vendor replies → customer gets confirmation card
- [ ] Phase 5: load-test `match-vendor-rate-bands` query with 200+ vendor_rate_bands rows to confirm index usage (`explain analyze`)

---

## Build Order Summary (at a glance)

1. Phase 0 setup → 2. Migrations 0001-0008 → 3. Route handlers 2.1-2.4 (trip request + OTP) →
4. Edge Function 3.1 (matching) wired into 2.1 → 5. Edge Function 3.2 (send-quotes) + job_queue worker 3.10 →
6. Webhook route 2.5 + Edge Functions 3.3/3.4 (negotiate/finalize) → 7. Edge Function 3.5/3.6 (vendor notify + parse) →
8. Edge Function 3.7 (confirmation card) → 9. Edge Functions 3.8/3.9 (lifecycle + expiry crons) →
10. Admin routes 2.6/2.7 → 11. Frontend wiring Phase 4 → 12. Testing gates Phase 5
