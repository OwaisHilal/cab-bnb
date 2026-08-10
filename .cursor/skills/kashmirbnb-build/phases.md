# Kashmir BnB Build Phases

Reference: `ref/kashmirbnb_supabase_implementation_checklist (1).md`
Product rules: `ref/kashmirbnb_whatsapp_engineering_plan (2).md`

---

## Phase 0 — Setup

**Checklist:** Phase 0

| Deliverable | Path / command |
|-------------|----------------|
| Supabase project | `supabase init`, `supabase link` |
| Extensions | `pgcrypto`, `pg_cron` |
| Server client | `lib/supabase/server.ts` |
| Browser client | `lib/supabase/client.ts` |
| Env template | `.env.example` |

**Gate:** `supabase status` runs; clients import without error.

---

## Phase 1 — Migrations

**Checklist:** Phase 1, files `0001`–`0008`

| File | Creates |
|------|---------|
| `0001_core_actors.sql` | tourists, vendors, vehicle_types + seed |
| `0002_rate_bands.sql` | vendor_rate_bands |
| `0003_trip_requests_and_quotes.sql` | trip_requests, quote_snapshots |
| `0004_otp.sql` | otp_verifications |
| `0005_bookings.sql` | bookings + enums |
| `0006_driver_details_and_messaging.sql` | driver_detail_submissions, whatsapp_message_log |
| `0007_lifecycle_and_jobs.sql` | booking_lifecycle_events, job_queue |
| `0008_rls_policies.sql` | RLS policies |

**Gate:** `supabase db reset` succeeds; vehicle_types has 3 rows; insert fixture vendor + bands.

---

## Phase 2a — Trip request + OTP routes

**Checklist:** 2.1–2.4

| Route | Depends on |
|-------|------------|
| `app/api/trip-requests/route.ts` | 0001–0003, function 3.1 |
| `app/api/trip-requests/[id]/route.ts` | 0003 |
| `app/api/otp/send/route.ts` | 0004 |
| `app/api/otp/verify/route.ts` | 0004, 0007 job_queue |

**Gate:** POST trip-requests returns matched_vendor_count for 7-pax test; OTP verify enqueues `send_quotes` row.

---

## Phase 2b — Send quotes + job worker

**Checklist:** 3.2, 3.10, 2.8

| Item | Notes |
|------|-------|
| `supabase/functions/send-quotes/` | Consolidated WA message |
| `supabase/functions/job-queue-worker/` | Routes job_type → function |
| `app/api/cron/dispatch-jobs/route.ts` | CRON_SECRET, every 1 min |

**Gate:** After OTP verify, quotes_sent status; whatsapp_message_log outbound row.

---

## Phase 2c — Webhook + negotiate + finalize

**Checklist:** 2.5, 3.3, 3.4

| Item | Notes |
|------|-------|
| `app/api/whatsapp/webhook/route.ts` | Fast 200, enqueue only |
| `supabase/functions/compute-negotiation/` | FOR UPDATE lock |
| `supabase/functions/finalize-booking/` | Sibling snapshots → lost |

**Gate:** Tampered signature rejected; NEGOTIATE enqueues job; BOOK_TOKEN creates booking.

---

## Phase 2d — Vendor notify + driver parse

**Checklist:** 3.5, 3.6

| Function | Trigger |
|----------|---------|
| `notify-vendor-booking` | After finalize |
| `parse-driver-details` | Webhook DRIVER: text |

**Gate:** Vendor message only after booking; parse_failed creates ops job.

---

## Phase 2e — Confirmation + lifecycle crons

**Checklist:** 3.7, 3.8, 3.9

| Function | Schedule |
|----------|----------|
| `send-confirmation-card` | On parse success |
| `dispatch-lifecycle-events` | 15 min |
| `expire-stale-quotes` | Hourly |

**Gate:** Lifecycle rows scheduled at booking; stale quotes expire.

---

## Phase 2f — Admin routes

**Checklist:** 2.6, 2.7

- `app/api/admin/rate-bands/route.ts`
- `app/api/admin/driver-details/[id]/correct/route.ts`

---

## Phase 4 — Frontend

**Checklist:** Phase 4

1. Trip form
2. Vendor-checking animation (matched_vendor_count)
3. OTP modal (QUOTE_REVEAL_DELAY_MS)
4. Realtime subscriptions
5. Optional in-app quote view

**Gate:** Full UI walk without breaking API contracts.

---

## Phase 5 — Integration test

**Checklist:** Phase 5 — run all gates before production deploy.

Happy path: trip → OTP → WA quote → negotiate → token book → vendor DRIVER reply → confirmation card.
