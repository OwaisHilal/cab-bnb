# WhatsApp & SMS Message Templates — Kashmir BnB Cabs

Reference for Meta WhatsApp template submission and MSG91 SMS/WhatsApp setup. Derived from the current codebase implementation (August 2026).

---

## Implementation summary

| Channel | Provider (current) | Provider (planned fallback) |
|---------|-------------------|----------------------------|
| WhatsApp OTP | MSG91 auth template (explicit retry from OTP sheet) | After SMS fails |
| WhatsApp quotes, negotiation, lifecycle | Meta Cloud API (`interactive`, `text`, `image`) | MSG91 (Phase 3) |
| SMS OTP | MSG91 SendOTP (`MSG91_OTP_TEMPLATE_ID`) | Phone.Email if SendOTP fails |

**Important:** Customer OTP is MSG91 **SMS SendOTP** first. If SMS fails, the API returns Phone.Email (`fallback: "phone_email"`). WhatsApp auth-template OTP is an optional **separate** request (`prefer=whatsapp` / “Try WhatsApp OTP”), not a third automatic send in the same call. Quotes/lifecycle still use the WhatsApp Cloud API until Phase 3.

**MSG91 status:** Default send is SMS SendOTP. Phone.Email UI if SMS fails. WhatsApp retry is `prefer=whatsapp`. Quotes/lifecycle still Meta Graph until Phase 3. Edge `sendSmsFallback` stays stub (quotes, not OTP). Approval tracker below stays `—` until you report Green from the MSG91 dashboard.

---

## Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `WHATSAPP_ACCESS_TOKEN` | Edge Functions (until Phase 3) | Meta Graph API bearer token |
| `WHATSAPP_PHONE_NUMBER_ID` | Edge Functions (until Phase 3) | Meta phone number ID for sends |
| `WHATSAPP_OTP_TEMPLATE_NAME` | Unused after Phase 2 (kept until Phase 5) | Former Graph OTP template name |
| `WHATSAPP_VERIFY_TOKEN` | `app/api/whatsapp/webhook/route.ts` | Meta webhook GET challenge (legacy; MSG91 never GETs) |
| `WHATSAPP_APP_SECRET` | Webhook signature verification | HMAC for leftover Meta envelopes only |
| `MSG91_WEBHOOK_SECRET` | `POST /api/whatsapp/webhook` | Custom header `x-msg91-webhook-secret` on MSG91 Webhook (New) |
| `MSG91_AUTH_KEY` | `lib/msg91/` + Deno `msg91WhatsApp.ts` | MSG91 `authkey` header |
| `MSG91_WHATSAPP_INTEGRATED_NUMBER` | Same | MSG91 WhatsApp sender number |
| `MSG91_OTP_TEMPLATE_NAME` | `lib/whatsapp/sendAuthTemplateOtp.ts` | Auth template name (default `otp_verification`) |
| `MSG91_OTP_TEMPLATE_NAMESPACE` | Same | Auth template namespace (omitted if blank) |
| `MSG91_OTP_TEMPLATE_LANGUAGE` | Same | Auth template language (default `en_US`) |
| `MSG91_OTP_TEMPLATE_ID` | `lib/sms/sendOtpSms.ts` | MSG91 **SMS** SendOTP template id (OTP section) |
| `SMS_PROVIDER_API_KEY` | unused | Placeholder — OTP SMS uses `MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID` |
| `CONFIRMATION_CARD_IMAGE_URL` | `sendConfirmationCard` handler | Generic confirmation card image |
| `CONFIRMATION_CARD_IMAGE_URL_<CODE>` | Same | Per-vehicle override (e.g. `_SEDAN`, `_SUV`, `_TEMPO`) |
| `MIDTRIP_WELLNESS_MIN_DAYS` | Lifecycle scheduler | Min trip days before mid-trip message (default `3`) |
| `VENDOR_DRIVER_DETAIL_SLA_MINUTES` | `vendorReplyTimeouts` handler | Vendor `DRIVER:` reply SLA before ops escalation (default `30`) |
| `OPS_ALERT_WEBHOOK_URL` | `opsAlert` handler | JSON webhook for ops (Slack relay, etc.) — **not** WhatsApp |
| `QUOTE_EXPIRY_HOURS` | `expireStaleQuotes` handler | Quote snapshot expiry (default `48`) |
| `EMAIL_PROVIDER_API_KEY` | `.env.example` only | **Not implemented** — plan mentions email fallback for quotes |

**OTP config** (`lib/otp/config.ts`): `OTP_EXPIRY_SECONDS` (300), `OTP_MAX_ATTEMPTS` (5), `OTP_RATE_LIMIT_MAX` (3), `OTP_RATE_LIMIT_WINDOW_MINUTES` (10).

**Phone send format:** Outbound `to` field strips the leading `+` from E.164 (`919876543210`). Inbound vendor matching normalizes to last 10 digits — stored `vendors.whatsapp_number` formatting may vary (`+91…`, `91…`, bare 10-digit).

**Token lock amount:** Button label hardcodes **₹99** (`Pay ₹99 to Lock`). Plan §14 documents `TOKEN_LOCK_AMOUNT` (default 99) as a config flag, but it is **not** env-driven in code yet — template copy should say ₹99 unless/until that flag is wired.

**Graph API version:** `v20.0` (hardcoded in `supabase/functions/_shared/whatsapp.ts` until Phase 3). OTP send no longer uses Graph.

---

## Template inventory (9 message types)

### 1. OTP verification

| Field | Value |
|-------|-------|
| **Handler** | `lib/whatsapp/sendAuthTemplateOtp.ts` → `app/api/otp/send/route.ts` |
| **Recipient** | Customer (tourist) |
| **Meta category** | **AUTHENTICATION** |
| **Send type (current)** | MSG91 bulk template (`body_1` + `button_1`) |
| **Template name (code default)** | `otp_verification` |
| **Env override** | `MSG91_OTP_TEMPLATE_NAME` / `MSG91_OTP_TEMPLATE_NAMESPACE` / `MSG91_OTP_TEMPLATE_LANGUAGE` |
| **Language** | `en_US` (fallback if `MSG91_OTP_TEMPLATE_LANGUAGE` unset) |
| **Parameters** | `body_1` text + `button_1` copy-code (`subtype: "url"`) = 6-digit OTP |

**Suggested Meta / MSG91 template body:**

```
Your Kashmir BnB Cabs verification code is {{1}}. Do not share this code with anyone.
```

Or use Meta's built-in **Authentication → One-time passcode** template flow (copy-code button) — the code comments note you may need extra `components` (e.g. button param) depending on how the template is approved.

**API payload shape (current code):** MSG91 bulk template via `lib/msg91/` — `body_1` + `button_1` (copy-code). See [`msg91-whatsapp-integration.md`](./msg91-whatsapp-integration.md) §3.1–§3.2.

**SMS (MSG91 SendOTP):** Same OTP, 6 digits, ~300s expiry. This is the **default** `/api/otp/send` channel (no `prefer`). Suggested SMS text:

```
Your Kashmir BnB Cabs OTP is {{otp}}. Valid for 5 minutes. Do not share.
```

**Flow:** Default send is SMS SendOTP. If SMS fails or is unconfigured, the route returns `{ sent: false, fallback: "phone_email" }` and the sheet shows Phone.Email. WhatsApp is **not** tried in that same request. The user may tap **Try WhatsApp OTP**, which POSTs `prefer: "whatsapp"` (MSG91 auth template). If WhatsApp also fails, Phone.Email is offered again. Phone.Email is a separate web verification path (`features/phone-email/`) — not a WhatsApp/SMS template.

**Trigger:** `POST /api/otp/send` (customer enters phone in OTP sheet). Default = SMS. `prefer=whatsapp` = WhatsApp retry.

---

### 2. Consolidated quote message

| Field | Value |
|-------|-------|
| **Handler** | `supabase/functions/_shared/handlers/sendQuotes.ts` |
| **Recipient** | Customer |
| **Meta category** | **UTILITY** |
| **Send type (current)** | `type: "interactive"` (quick-reply buttons) |
| **Suggested template name** | `quote_consolidated_v1` (not wired in code yet) |

**Body (dynamic lines per matched vendor):**

```
Your Kashmir Cab Quotes Are In 🚖

⭐ Best Price — {{vendor_name}}: ₹{{amount}}/day ({{vehicle_label}})
{{vendor_name}}: ₹{{amount}}/day ({{vehicle_label}})
...

Prices shown are opening quotes. You can negotiate.
```

**Variables:**

| # | Name | Example | Source |
|---|------|---------|--------|
| 1+ | Vendor lines | `⭐ Best Price — Vendor A: ₹2500/day (Sedan)` | `quote_snapshots` + `vendors` + `vehicle_types` |
| — | Best-price snapshot ID | UUID | `is_best_price` row (buttons target this snapshot) |

**Buttons (max 3 — WhatsApp limit):**

| Label | Payload | Action |
|-------|---------|--------|
| Book Best Price | `BOOK_FULL::{{quote_snapshot_id}}` | Full booking |
| Negotiate | `NEGOTIATE::{{quote_snapshot_id}}` | Next negotiation round |
| Pay ₹99 to Lock | `BOOK_TOKEN::{{quote_snapshot_id}}` | Token lock booking |

Button titles are capped at **20 characters** by Meta.

**SMS / email fallback:** Stub only (`sendSmsFallback` in `supabase/functions/_shared/whatsapp.ts`) — not implemented. Engineering plan §5 also mentions email fallback after SMS; **no email send code exists**.

**Trigger:** `send_quotes` job, enqueued by `POST /api/otp/verify` (and Phone.Email verify) after OTP success — not at trip-request creation.

**Read receipt side effect:** When Meta delivers `status: "read"` for this message's `wa_message_id`, `quote_snapshots.status` advances `sent` → `viewed` (`app/api/whatsapp/webhook/route.ts`).

**Not implemented (plan only):** WhatsApp **List Message** for per-vendor rows when >3 vendors need individual actions (Plan §6.1). Code always uses one consolidated body + 3 buttons targeting the best-price snapshot.

---

### 3. Negotiation response (counter-offer)

| Field | Value |
|-------|-------|
| **Handler** | `supabase/functions/_shared/handlers/computeNegotiation.ts` |
| **Recipient** | Customer |
| **Meta category** | **UTILITY** |
| **Send type (current)** | `type: "interactive"` |
| **Suggested template name** | `negotiation_offer_v1` / `negotiation_final_v1` |

**Body — mid-negotiation:**

```
Here's our next offer: ₹{{next_quote}}/day.
```

**Buttons (3):**

| Label | Payload |
|-------|---------|
| Book This Price | `BOOK_FULL::{{quote_snapshot_id}}` |
| Negotiate Again | `NEGOTIATE::{{quote_snapshot_id}}` |
| Pay ₹99 to Lock | `BOOK_TOKEN::{{quote_snapshot_id}}` |

**Body — final offer** (`is_final = true`):

```
This is our best possible price: ₹{{next_quote}}/day. Final offer.
```

**Buttons (2):**

| Label | Payload |
|-------|---------|
| Book Now | `BOOK_FULL::{{quote_snapshot_id}}` |
| Pay ₹99 to Lock | `BOOK_TOKEN::{{quote_snapshot_id}}` |

**Trigger:** `compute_negotiation` job — enqueued when customer taps `NEGOTIATE` (webhook) or `POST /api/quotes/:id/negotiate` (in-app fallback).

**Spec vs code:** Plan §6.2 example includes prior price (`₹2,420/day (was ₹2,500)`). **Current code does not include "was" price** — only the new amount.

**No customer message on book:** `finalize_booking` does not send WhatsApp; confirmation card waits until vendor submits driver details (Plan §6.4).

---

### 4. Vendor booking notification

| Field | Value |
|-------|-------|
| **Handler** | `supabase/functions/_shared/handlers/notifyVendorBooking.ts` |
| **Recipient** | Winning vendor |
| **Meta category** | **UTILITY** |
| **Send type (current)** | `type: "text"` (free-form) |
| **Suggested template name** | `vendor_booking_notify_v1` |

**Body:**

```
New booking confirmed 🎉
Route: {{pickup}} → {{drop}}
Date: {{pickup_date}}, {{trip_days}} {{day_label}}
Pax: {{pax_count}} | Vehicle: {{vehicle_label}}
Price: ₹{{final_quote}}/day

Reply in this format to assign driver:
DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>

Example:
DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire
```

**Variables:**

| # | Field | Example |
|---|-------|---------|
| 1 | pickup_location | Srinagar |
| 2 | drop_location | Pahalgam |
| 3 | pickup_date | 14 Aug |
| 4 | trip_days | 3 |
| 5 | day_label | days / day |
| 6 | pax_count | 4 |
| 7 | vehicle_label | Sedan |
| 8 | final_quote | 2420 |

**Inbound expected reply (free text, not a template):**

```
DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire
```

Parsed by `lib/whatsapp/webhook/parseInboundAction.ts` → `parse_driver_details` job. Malformed `DRIVER:` prefix still enqueues parse job; strict regex re-run in `parseDriverDetails.ts` files `parse_failed` + `ops_alert`.

**Trigger:** `notify_vendor_booking` job — enqueued by `finalize_quote_booking` RPC after customer books.

**SLA escalation (no WhatsApp):** If vendor does not reply within `VENDOR_DRIVER_DETAIL_SLA_MINUTES`, cron `vendor_reply_timeouts` marks booking `no_response_exception` and enqueues `ops_alert` — **no outbound WhatsApp to vendor or customer**.

---

### 5. Customer confirmation card

| Field | Value |
|-------|-------|
| **Handler** | `supabase/functions/_shared/handlers/sendConfirmationCard.ts` |
| **Recipient** | Customer |
| **Meta category** | **UTILITY** |
| **Send type (current)** | `type: "image"` + caption, or `type: "text"` if no image URL |
| **Suggested template name** | `customer_confirmation_v1` |

**Caption / text body:**

```
Your Cab Is Confirmed ✅
Driver: {{driver_name}}
Vehicle: {{vehicle_model}} ({{vehicle_number}})
Pickup: {{pickup_datetime}} — {{pickup_location}}
Vendor: {{vendor_name}}
```

**Image:** Public HTTPS URL from `CONFIRMATION_CARD_IMAGE_URL` or `CONFIRMATION_CARD_IMAGE_URL_<VEHICLE_CODE>`.

**Trigger:** `send_confirmation_card` job — after successful `parse_driver_details` (or admin driver-details correction).

**Also schedules** all lifecycle events below (`booking_lifecycle_events` rows).

---

### 6. Pre-pickup reminder

| Field | Value |
|-------|-------|
| **Handler** | `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts` |
| **Event type** | `pre_pickup_reminder` |
| **Recipient** | Customer |
| **Meta category** | **UTILITY** |
| **Send type (current)** | `type: "text"` |
| **Suggested template name** | `pre_pickup_reminder_v1` |
| **Scheduled** | 12 hours before pickup |

**Body:**

```
Reminder: your Kashmir cab pickup is tomorrow 🚗
Driver: {{driver_name}}, Vehicle: {{vehicle_model}} ({{vehicle_number}})
Need help? Reply to this message and our support team will assist.
```

If driver details missing: `Driver details are being finalized.`

**Trigger:** `dispatch_lifecycle_events` cron (every ~15 min) when `event_type = pre_pickup_reminder` and `scheduled_at <= now()`.

---

### 7. Day-1 check-in

| Field | Value |
|-------|-------|
| **Handler** | `dispatchLifecycleEvents.ts` |
| **Event type** | `day1_checkin` |
| **Recipient** | Customer |
| **Meta category** | **UTILITY** |
| **Send type (current)** | `type: "interactive"` |
| **Suggested template name** | `day1_checkin_v1` |
| **Scheduled** | 2 hours after pickup time |

**Body:**

```
How was your pickup this morning?
```

**Buttons:**

| Label | Payload | Handler action |
|-------|---------|----------------|
| All Good | `CHECKIN_OK::{{lifecycle_event_id}}` | `checkin_ok` |
| Report Issue | `CHECKIN_HELP::{{lifecycle_event_id}}` | `checkin_help` → ops alert |

**Trigger:** Same lifecycle cron; `CHECKIN_HELP` enqueues `ops_alert` (webhook JSON, not WhatsApp).

---

### 8. Mid-trip wellness check

| Field | Value |
|-------|-------|
| **Handler** | `dispatchLifecycleEvents.ts` |
| **Event type** | `midtrip_wellness` |
| **Recipient** | Customer |
| **Meta category** | **UTILITY** |
| **Send type (current)** | `type: "interactive"` |
| **Suggested template name** | `midtrip_wellness_v1` |
| **Scheduled** | 1.5 days after pickup (only if `trip_days >= MIDTRIP_WELLNESS_MIN_DAYS`, default 3) |

**Body:**

```
Everything going smoothly on your trip so far?
```

**Buttons:**

| Label | Payload |
|-------|---------|
| Yes, all good | `CHECKIN_OK::{{lifecycle_event_id}}` |
| Need Help | `CHECKIN_HELP::{{lifecycle_event_id}}` |

---

### 9. Post-trip review

| Field | Value |
|-------|-------|
| **Handler** | `dispatchLifecycleEvents.ts` |
| **Event type** | `post_trip_review` |
| **Recipient** | Customer |
| **Meta category** | **UTILITY** (or MARKETING — confirm with Meta policy) |
| **Send type (current)** | `type: "interactive"` |
| **Suggested template name** | `post_trip_review_v1` |
| **Scheduled** | `trip_days` + 1 day after pickup |

**Body:**

```
How was your trip? Tap a rating below.
```

**Buttons (3 ratings — WhatsApp max):**

| Label | Payload | Rating |
|-------|---------|--------|
| Excellent | `RATE_5::{{booking_id}}` | 5 |
| Okay | `RATE_3::{{booking_id}}` | 3 |
| Poor | `RATE_1::{{booking_id}}` | 1 |

Note: Payload uses `booking_id`, not lifecycle event id (see code comment in handler). Parser accepts `RATE_1`–`RATE_5` but only 1, 3, and 5 are sent as buttons.

---

## Lifecycle schedule (all customer messages)

Created in `sendConfirmationCard.ts` when driver details are attached. Processed by `dispatch_lifecycle_events` cron (`app/api/cron/dispatch-lifecycle-events/route.ts`).

| Event type | Scheduled at | Send type |
|------------|--------------|-----------|
| `pre_pickup_reminder` | Pickup time − 12 hours | text |
| `day1_checkin` | Pickup time + 2 hours | interactive (2 buttons) |
| `midtrip_wellness` | Pickup time + 1.5 days (only if `trip_days >= MIDTRIP_WELLNESS_MIN_DAYS`) | interactive (2 buttons) |
| `post_trip_review` | Pickup time + `trip_days` + 1 day | interactive (3 buttons) |

Plan §6.5 describes pre-pickup as "evening before pickup day"; code uses a fixed **12-hour** offset.

---

## Outbound job trigger map

| Job type | Outbound WhatsApp? | Enqueued by |
|----------|-------------------|-------------|
| `send_quotes` | Yes — consolidated quote | OTP verify, Phone.Email verify |
| `compute_negotiation` | Yes — counter-offer | Webhook `NEGOTIATE`, API negotiate route |
| `finalize_booking` | No | Webhook `BOOK_FULL` / `BOOK_TOKEN`, API finalize |
| `notify_vendor_booking` | Yes — vendor text | `finalize_quote_booking` RPC |
| `parse_driver_details` | No | Webhook vendor `DRIVER:` text |
| `send_confirmation_card` | Yes — image/text card | Successful driver parse, admin correction |
| `dispatch_lifecycle_events` | Yes — lifecycle msgs | Cron (also runnable as manual job) |
| `record_lifecycle_response` | No | Webhook check-in buttons |
| `record_review` | No | Webhook rating buttons |
| `ops_alert` | No — `OPS_ALERT_WEBHOOK_URL` only | Check-in help, parse failures, vendor SLA |
| `vendor_reply_timeouts` | No | Cron |
| `expire_stale_quotes` | No | Cron |

Worker: `supabase/functions/job-queue-worker` (+ dedicated cron Edge Functions for lifecycle / expiry / vendor SLA).

---

## Inbound-only (no outbound template)

These are **customer/vendor replies** the webhook accepts — not messages you send.

| Input | Parser result | Backend action |
|-------|---------------|----------------|
| `DRIVER: name \| phone \| reg \| model` | `driver_details` | `parse_driver_details` → confirmation card or ops |
| `DRIVER:` malformed prefix | `driver_details` (no preview) | Same job; likely `parse_failed` |
| Button payloads (see below) | `book_full`, etc. | Matching job |
| `list_reply` id | Same as button | Parser supports it; **no list messages sent outbound** |
| Any other free text | `unknown` | Logged only — **no auto-reply template** (e.g. customer replying "Need help?" to pre-pickup reminder) |

Webhook: `GET/POST /api/whatsapp/webhook`. Inbound dedupe via unique `wa_message_id` on `whatsapp_message_log`.

---

## Button payload reference (inbound webhook)

All inbound button clicks arrive at `POST /api/whatsapp/webhook`. Payload format: `ACTION::entity_id`.

| Action prefix | Entity ID | Parsed type | Triggers |
|---------------|-----------|-------------|----------|
| `BOOK_FULL` | `quote_snapshot_id` | `book_full` | Booking finalize (full payment) |
| `BOOK_TOKEN` | `quote_snapshot_id` | `book_token` | Booking finalize (₹99 token) |
| `NEGOTIATE` | `quote_snapshot_id` | `negotiate` | `compute_negotiation` job |
| `CHECKIN_OK` | `lifecycle_event_id` | `checkin_ok` | Lifecycle response recorded |
| `CHECKIN_HELP` | `lifecycle_event_id` | `checkin_help` | Ops alert |
| `RATE_1` … `RATE_5` | `booking_id` | `rate` | Review recorded |

**Vendor free-text:** `DRIVER: name | phone | vehicle_number | vehicle_model`

---

## MSG91 setup checklist

Use this when registering templates on MSG91 (SMS OTP first, then WhatsApp utility templates if using MSG91 as BSP).

### SMS (OTP) — priority 1

- [x] MSG91 SendOTP in `lib/sms/sendOtpSms.ts` (`MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`)
- [ ] Register DLT / OTP template in MSG91 OTP section; set `MSG91_OTP_TEMPLATE_ID`
- [ ] Restart `next dev` and confirm default `/api/otp/send` returns `{ sent: true, channel: "sms" }`
- [ ] Confirm empty/missing template id shows Phone.Email, not a silent WhatsApp-first send

### WhatsApp via MSG91 (if not using direct Meta API)

- [ ] Map each template name above to MSG91 WhatsApp template IDs
- [ ] Match variable order (`{{1}}`, `{{2}}`, …) to MSG91 placeholder rules
- [ ] For interactive messages: confirm MSG91 supports quick-reply buttons or use approved template + session messages
- [ ] Authentication template: `otp_verification` (or your approved name)

### Meta direct (current architecture)

- [ ] Submit templates 2–9 as **UTILITY** in Meta Business Manager → WhatsApp Manager → Message Templates
- [ ] Submit template 1 as **AUTHENTICATION**
- [ ] Record approved names and update env vars / handler code when switching from free-form to `type: "template"`
- [ ] Set Edge Function secrets separately (`supabase secrets set`) — they do not read `.env.local` (see `.env.example` comments)

### Not needed for MSG91 / Meta (no customer WhatsApp)

- [ ] `OPS_ALERT_WEBHOOK_URL` for internal ops (check-in help, vendor SLA, parse failures)
- [ ] `EMAIL_PROVIDER_API_KEY` — reserved; no quote/OTP email sends implemented

---

## Approval status tracker

Update as templates are submitted and approved.

| # | Message type | Suggested name | Meta category | Meta status | MSG91 status | Wired in code |
|---|--------------|----------------|---------------|-------------|--------------|---------------|
| 1 | OTP verification | `otp_verification` | AUTHENTICATION | — | — | MSG91 (`sendAuthTemplateOtp.ts`) — status not user-reported Green |
| 2 | Consolidated quote | `quote_consolidated_v1` | UTILITY | — | — | No (interactive) |
| 3 | Negotiation offer | `negotiation_offer_v1` | UTILITY | — | — | No (interactive) |
| 3b | Negotiation final | `negotiation_final_v1` | UTILITY | — | — | No (interactive) |
| 4 | Vendor notification | `vendor_booking_notify_v1` | UTILITY | — | — | No (text) |
| 5 | Confirmation card | `customer_confirmation_v1` | UTILITY | — | — | No (image/text) |
| 6 | Pre-pickup reminder | `pre_pickup_reminder_v1` | UTILITY | — | — | No (text) |
| 7 | Day-1 check-in | `day1_checkin_v1` | UTILITY | — | — | No (interactive) |
| 8 | Mid-trip wellness | `midtrip_wellness_v1` | UTILITY | — | — | No (interactive) |
| 9 | Post-trip review | `post_trip_review_v1` | UTILITY | — | — | No (interactive) |

---

## Source files

| Area | Path |
|------|------|
| MSG91 WhatsApp client (Next) | `lib/msg91/` |
| MSG91 WhatsApp client (Deno) | `supabase/functions/_shared/msg91WhatsApp.ts` |
| OTP WhatsApp template send (retry) | `lib/whatsapp/sendAuthTemplateOtp.ts` |
| OTP API route | `app/api/otp/send/route.ts` |
| SMS SendOTP | `lib/sms/sendOtpSms.ts` |
| Edge WhatsApp helpers | `supabase/functions/_shared/whatsapp.ts` |
| Send quotes | `supabase/functions/_shared/handlers/sendQuotes.ts` |
| Negotiation | `supabase/functions/_shared/handlers/computeNegotiation.ts` |
| Vendor notify | `supabase/functions/_shared/handlers/notifyVendorBooking.ts` |
| Confirmation card | `supabase/functions/_shared/handlers/sendConfirmationCard.ts` |
| Lifecycle messages | `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts` |
| Inbound parsing | `lib/whatsapp/webhook/parseInboundAction.ts` |
| Webhook payload parsing | `lib/whatsapp/webhook/parseWebhookPayload.ts` |
| Webhook route | `app/api/whatsapp/webhook/route.ts` |
| Webhook → job enqueue | `lib/whatsapp/webhook/enqueueWebhookAction.ts` |
| Job worker | `supabase/functions/job-queue-worker/index.ts` |
| Ops alerts (not WhatsApp) | `supabase/functions/_shared/handlers/opsAlert.ts` |
| Vendor SLA (not WhatsApp) | `supabase/functions/_shared/handlers/vendorReplyTimeouts.ts` |
| Driver parse | `supabase/functions/_shared/handlers/parseDriverDetails.ts` |
| Message logging | `supabase/functions/_shared/messageLog.ts` |
| Engineering plan (spec) | `ref/kashmirbnb_whatsapp_engineering_plan (2).md` §6 |
| Env template | `.env.example` |

---

## Confirmed complete vs not in codebase

**All 9 outbound message types are documented** — no additional WhatsApp send helpers exist beyond `sendAuthTemplateOtp.ts` and `supabase/functions/_shared/whatsapp.ts` (`sendWhatsAppButtonMessage`, `sendWhatsAppTextMessage`, `sendWhatsAppImageMessage`, `sendSmsFallback` stub).

**Planned in spec but not implemented (no template to register yet):**

- Email fallback for quotes (`EMAIL_PROVIDER_API_KEY`)
- SMS fallback for quotes (Edge `sendSmsFallback` stub)
- WhatsApp List Messages for multi-vendor selection
- Negotiation body with "(was ₹X)" prior price
- Env-driven `TOKEN_LOCK_AMOUNT` in button labels
- Auto-reply when customer sends unrecognized free text
- Outbound WhatsApp to ops or customers on vendor SLA timeout

---

## Notes for template reviewers

1. **Do not change wording** in approved templates without re-submission — match the hardcoded strings in handlers exactly.
2. **Quick-reply buttons** are limited to **3 per message** and **20 characters per label**.
3. **Consolidated quote** uses one message for all vendors; buttons always target the best-price snapshot.
4. **24-hour window:** Free-form `text` / `interactive` sends only work inside the customer service window unless you use approved templates.
5. **OTP** is the only path that must work for new users (pre-window) — prioritize AUTHENTICATION template approval and MSG91 SMS fallback.
6. **Post-booking flow gap:** Customer gets no WhatsApp between "Book" and vendor driver reply — only vendor notification + later confirmation card.
