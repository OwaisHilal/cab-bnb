# Kashmir BnB Merged Audit Checklist

**Plan:** `ref/kashmirbnb_whatsapp_engineering_plan (2).md`
**Checklist:** `ref/kashmirbnb_supabase_implementation_checklist (1).md`

---

## Phase 0 — Project setup (Checklist)

- [ ] `supabase init` in project root
- [ ] `supabase link --project-ref <ref>`
- [ ] Extensions: `pgcrypto`, `pg_cron`
- [ ] `.env.local` with all required keys (Checklist Phase 0)
- [ ] `.env.example` (keys only, no secrets)
- [ ] `lib/supabase/server.ts` (service-role, server-only)
- [ ] `lib/supabase/client.ts` (anon, browser-safe)
- [ ] Hosting env vars configured; service role server-only

---

## Phase 1 — Migrations (Checklist 0001–0008)

### 0001_core_actors.sql
- [ ] `tourists` table (phone_e164 unique)
- [ ] `vendors` table (onboarding_stage, status, whatsapp_number)
- [ ] `vehicle_types` table + seed: sedan, suv, tempo
- [ ] Verify: `select * from vehicle_types` → 3 rows

### 0002_rate_bands.sql
- [ ] `season_quarter` enum
- [ ] `vendor_rate_bands` with all columns + constraints
- [ ] `idx_rate_bands_lookup` partial index
- [ ] Verify: fixture bands; manual match for pax=7

### 0003_trip_requests_and_quotes.sql
- [ ] `trip_requests` + indexes
- [ ] `quote_channel`, `quote_snapshot_status` enums
- [ ] `quote_snapshots` with negotiation_history jsonb
- [ ] Verify: FK integrity on fake insert

### 0004_otp.sql
- [ ] `otp_verifications` with `otp_code_hash` (not plaintext)
- [ ] Verify: expiry filter query works

### 0005_bookings.sql
- [ ] `booking_status` enum (includes quote_negotiating, token_locked, no_response_exception)
- [ ] `payment_status` enum
- [ ] `bookings` full table (not just ALTER)
- [ ] Verify: booking refs finalized quote_snapshot; no cascade on tourist delete

### 0006_driver_details_and_messaging.sql
- [ ] `driver_detail_submissions`
- [ ] `whatsapp_message_log` full table with trip_request_id, quote_snapshot_id, button_payload, interaction_type
- [ ] `wa_message_id` UNIQUE (idempotency)
- [ ] Verify: duplicate wa_message_id rejected

### 0007_lifecycle_and_jobs.sql
- [ ] `lifecycle_event_type` enum
- [ ] `booking_lifecycle_events` + scheduled index
- [ ] `job_queue` + pending index
- [ ] Verify: worker query returns due jobs

### 0008_rls_policies.sql
- [ ] RLS enabled on tourists, trip_requests, bookings, quote_snapshots
- [ ] Policies for tourist read own data (or documented skip if custom OTP only)
- [ ] Verify: anon select on bookings returns 0 without auth

---

## Phase 2 — API routes (Checklist)

### 2.1 POST `app/api/trip-requests/route.ts`
- [ ] Body: pickup, drop, trip_start_date, trip_days, pax_count, requested_vehicle_type_id, session_id
- [ ] Creates trip_request, runs match, recommendation, quote_snapshots
- [ ] Sets is_best_price, status quotes_ready
- [ ] Returns trip_request_id, matched_vendor_count, recommendation
- [ ] No WhatsApp send (Plan §5)

### 2.2 GET `app/api/trip-requests/[id]/route.ts`
- [ ] Poll trip_request + quote_snapshots

### 2.3 POST `app/api/otp/send/route.ts`
- [ ] Rate limit 3/10min per phone
- [ ] 6-digit OTP, hashed, 5min expiry
- [ ] SMS SendOTP first, then Phone.Email on SMS fail; WhatsApp auth template only on `prefer=whatsapp`

### 2.4 POST `app/api/otp/verify/route.ts`
- [ ] Verify hash, cap attempts
- [ ] Upsert tourist, link trip_request
- [ ] Enqueue job_type `send_quotes` (async)
- [ ] No inline WhatsApp send

### 2.5 GET+POST `app/api/whatsapp/webhook/route.ts`
- [ ] GET hub.challenge + WHATSAPP_VERIFY_TOKEN
- [ ] POST: X-Hub-Signature-256 HMAC
- [ ] wa_message_id dedupe
- [ ] Branch: BOOK_FULL, BOOK_TOKEN, NEGOTIATE, CHECKIN_*, RATE_*, DRIVER text
- [ ] Enqueue jobs only; return 200 fast

### 2.6 Admin `app/api/admin/rate-bands/route.ts`
- [ ] GET/POST/PATCH vendor_rate_bands, auth-gated

### 2.7 Admin `app/api/admin/driver-details/[id]/correct/route.ts`
- [ ] PATCH parse_failed → triggers confirmation job

### 2.8 POST `app/api/cron/dispatch-jobs/route.ts`
- [ ] CRON_SECRET secured
- [ ] Pulls job_queue, routes to Edge Functions, retry/backoff

### Plan §10 fallback routes
- [ ] POST `/api/quotes/:id/negotiate`
- [ ] POST `/api/bookings/finalize`
- [ ] GET `/api/admin/trip-requests`
- [ ] GET `/api/admin/bookings`

---

## Phase 3 — Edge Functions (Checklist)

- [ ] `match-vendor-rate-bands` — Plan §3.2, §3.3
- [ ] `send-quotes` — consolidated message; quote SMS/email fallback stays stub
- [ ] `compute-negotiation` — Plan §3.4, SELECT FOR UPDATE
- [ ] `finalize-booking` — lock types, sibling snapshots → lost
- [ ] `notify-vendor-booking` — post-commit only (Plan §6.3)
- [ ] `parse-driver-details` — Plan §7.3 regex, parse_failed → ops
- [ ] `send-confirmation-card` — Plan §6.4 + schedule lifecycle
- [ ] `dispatch-lifecycle-events` — cron 15 min
- [ ] `expire-stale-quotes` — cron hourly, QUOTE_EXPIRY_HOURS
- [ ] `job-queue-worker` — dispatcher every 1 min, all job_types

---

## Phase 4 — Frontend (Checklist + Plan §5)

- [ ] Trip form → POST trip-requests
- [ ] Animation uses matched_vendor_count (not random)
- [ ] OTP modal after QUOTE_REVEAL_DELAY_MS
- [ ] OTP send/verify flow
- [ ] Realtime on trip_requests + quote_snapshots post-verify
- [ ] Optional in-app quote fallback (read-only, no min_quote leak)

---

## Phase 5 — Test gates (Checklist)

- [ ] `supabase db reset` clean on fresh project
- [ ] Fixture match: 4pax/1day, 2pax/1day, 7pax/1day
- [ ] 7-pax sedan recommendation test
- [ ] OTP e2e: default SMS SendOTP; WhatsApp retry (`prefer=whatsapp`); Phone.Email when the chosen channel fails
- [ ] Webhook rejects tampered signature
- [ ] Double-tap negotiate no duplicate rounds
- [ ] Malformed DRIVER: → parse_failed + ops alert
- [ ] Job worker retries then marks failed
- [ ] Full happy path on real WhatsApp test number
- [ ] EXPLAIN ANALYZE on match with 200+ rate bands

---

## Plan product invariants (cross-cutting)

- [ ] No vendor WhatsApp at quote-request time
- [ ] Opening quote = max_quote per vendor
- [ ] OTP gates quote delivery, not matching
- [ ] Negotiation randomized server-side only
- [ ] TOKEN_LOCK_AMOUNT ₹99 (Plan §14)
- [ ] Lifecycle: pre_pickup, day1_checkin, midtrip (3+ days), post_trip_review

---

## Plan state machines (§8)

### trip_request.status
- [ ] matching → quotes_ready → otp_pending → quotes_sent → negotiating → booked | expired | abandoned

### booking.status
- [ ] draft → payment_pending → token_locked | fully_paid → vendor_confirming → vendor_confirmed → driver_attach_pending → driver_attached → ready_for_pickup → in_trip → completed
- [ ] cancelled | refund_pending | refunded

### quote_snapshot.status
- [ ] pending_send → sent → viewed → negotiating → finalized | expired | lost

---

## Config flags (Plan §14)

- [ ] QUOTE_REVEAL_DELAY_MS (4500)
- [ ] OTP_EXPIRY_SECONDS (300)
- [ ] OTP_MAX_ATTEMPTS (5)
- [ ] QUOTE_EXPIRY_HOURS (48)
- [ ] TOKEN_LOCK_AMOUNT (99)
- [ ] VENDOR_DRIVER_DETAIL_SLA_MINUTES
- [ ] MIDTRIP_WELLNESS_MIN_DAYS (3)

---

## Security (Plan §11)

- [ ] Webhook signature on every POST
- [ ] OTP rate limiting
- [ ] min_quote / negotiation_step_* never client-exposed
- [ ] OTP hashed at rest
- [ ] RLS or API-only access for tourist data
- [ ] All WA in/out in whatsapp_message_log
