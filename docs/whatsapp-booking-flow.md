# WhatsApp booking flow — messages, MSG91 config, and code

End-to-end reference for KMR BnB Cabs: who gets which message, exact copy, MSG91 send method, env vars, and source files.

**Single source of truth for copy:** `public.whatsapp_message_templates` in Supabase (loaded via `lib/whatsapp/messageTemplateStore.ts` on Next.js and `supabase/functions/_shared/messageTemplateStore.ts` on Edge). Builders in `lib/whatsapp/templateCatalog.ts` / `templateMessages.ts` render `body_template` with `{{variables}}`.

**Catalog for MSG91 dashboard registration:** `templates/msg91/whatsapp-templates.json` (mirror of DB `dashboard_body` for paste into MSG91)  
**Dashboard checklist:** `docs/msg91-whatsapp-dashboard-templates.md`  
**Run checklist script:** `npm run msg91:templates`

---

## Raw templates — three layers

| Layer | What it is | Where |
|-------|------------|--------|
| **0. App template store (primary)** | Runtime copy, send method, list/button config | `whatsapp_message_templates` table — migration `20260814000100_0012_whatsapp_message_templates.sql` |
| **1. Dashboard raw template** | Text you **paste into MSG91 → WhatsApp → Templates → Create** (`{{1}}`, `{{2}}`, buttons) | DB column `dashboard_body` + `templates/msg91/whatsapp-templates.json` |
| **2. Bulk send API raw JSON** | What code **POSTs** to `…/whatsapp-outbound-message/bulk/` when using **Send WhatsApp template** | `buildMsg91BulkTemplateBody()` in `lib/msg91/pure.ts` |
| **3. Session send API raw JSON** | What code **POSTs** to `…/whatsapp-outbound-message/` for list / button / text (no dashboard template) | `buildMsg91InteractiveListBody()`, `buildMsg91InteractiveButtonBody()`, text URL |

**Dashboard variable `{{N}}` ↔ code `body_N`:** When sending bulk templates, code passes `body_1`, `body_2`, … in `components` (see OTP example below). Meta/MSG91 map these to `{{1}}`, `{{2}}` in the approved template.

**Canonical dashboard bodies:** DB column `dashboard_body` on `whatsapp_message_templates`, or `resolveMsg91DashboardBody()` in `lib/whatsapp/templateCatalog.ts`.

---

## Architecture overview

```text
Customer app                    Server                         MSG91                         Audiences
─────────────                   ──────                         ─────                         ─────────
Trip form ───────────────────► trip_request + quotes
OTP verify ──────────────────► send_quotes job / demo path ──► session LIST ─────────────► Guest
Tap list row (BOOK_TOKEN) ───► finalize booking ────────────► (no WA to guest on book)
                               notify_vendor ────────────────► session TEXT ──────────────► Nova (vendor)
Nova replies DRIVER:... ─────► parse_driver_details ◄──────── inbound TEXT ◄────────────── Nova
                               send_balance_payment ─────────► session BUTTON ───────────► Guest
Tap COMPLETE_PAYMENT ────────► complete_balance_payment ─────► session TEXT ────────────► Guest (contact)
                                                            └──► session TEXT ────────────► Driver (assign)
Mock chat / admin flow ◄─────── whatsapp_message_log (same payloads)
```

### MSG91 send methods (4 types)

| Method | API | Used for |
|--------|-----|----------|
| **Bulk template** | `POST …/whatsapp-outbound-message/bulk/` | WhatsApp OTP only (in code today) |
| **Session list** | `POST …/whatsapp-outbound-message/` + `content_type: interactive`, `type: list` | Guest quote picker |
| **Session button** | Same + `type: button` | Balance payment, lifecycle check-in/review |
| **Session text** | Same endpoint (text query or body) | Nova notify, driver contact, driver assignment, reminders |
| **Session image** | Same endpoint (image JSON) | Confirmation card (when image URL exists) |

**Important:** Creating a template in the MSG91 dashboard ≠ sending via bulk template API. Most booking messages use **session** APIs because button/list row IDs are dynamic (`BOOK_TOKEN::{uuid}`).

### Shared send + log (demo = production path)

| Layer | File |
|-------|------|
| Message builders | `lib/whatsapp/templateCatalog.ts` |
| Route spec → MSG91/Meta | `lib/whatsapp/sendWhatsAppMessage.ts` |
| MSG91 list/button/text | `lib/msg91/pure.ts`, `lib/whatsapp/sendOutbound.ts` |
| Deliver + log (demo post-₹99) | `lib/whatsapp/deliverAndLogOutbound.ts` |
| Quote delivery | `lib/whatsapp/deliverQuoteWhatsApp.ts` |
| Edge duplicate MSG91 | `supabase/functions/_shared/msg91WhatsApp.ts`, `whatsapp.ts` |

When `DEMO_MODE=true` and MSG91 is not configured, `applyDemoSendFallback()` in `deliverAndLogOutbound.ts` marks the send as simulated but still writes `whatsapp_message_log` so mock chat and admin flow work.

---

## Environment configuration

```env
# Required for any real WhatsApp outbound via MSG91
MSG91_AUTH_KEY=
MSG91_WHATSAPP_INTEGRATED_NUMBER=

# Demo (local presentations)
DEMO_MODE=true   # Fixed OTP 123456; simulated payment; send fallback when MSG91 missing

# WhatsApp OTP (bulk template — optional retry via prefer=whatsapp)
MSG91_OTP_TEMPLATE_NAME=otp_verification
MSG91_OTP_TEMPLATE_NAMESPACE=
MSG91_OTP_TEMPLATE_LANGUAGE=en_US

# Optional utility template names (dashboard registration; most sends still use session API)
MSG91_QUOTE_SINGLE_TEMPLATE_NAME=quote_single_v1
MSG91_VENDOR_NOTIFY_TEMPLATE_NAME=vendor_booking_notify_v1
MSG91_DRIVER_BALANCE_TEMPLATE_NAME=driver_balance_v1
MSG91_DRIVER_CONTACT_TEMPLATE_NAME=driver_contact_v1
# … see .env.example and templates/msg91/whatsapp-templates.json
```

Vendor WhatsApp numbers come from seed: `vendors.whatsapp_number` (e.g. Nova `+919999900001`).

---

## Flow steps (6 core + OTP + lifecycle)

Admin debug labels these in `features/admin-debug/messagingFlow.ts` → **Guest · Nova · Driver** tabs.

---

### Step 0 — OTP (before quotes)

| | |
|---|---|
| **Audience** | Guest |
| **Trigger** | `POST /api/otp/send` with `prefer=whatsapp` (default path is SMS, not WhatsApp) |
| **Template key** | `otp_verification` |
| **MSG91 method** | **Bulk template** (`sendMsg91TemplateMessage`) |
| **Dashboard category** | AUTHENTICATION |
| **Code** | `lib/whatsapp/sendAuthTemplateOtp.ts` → `lib/msg91/send.ts` |

**Dashboard body (register in MSG91):**

```text
Your Kashmir BnB Cabs verification code is {{1}}. Do not share this code with anyone.
```

**Button:** OTP copy-code  
**Variables:** `body_1` = 6-digit code, `button_1` copy-code = same code  

**Demo:** `DEMO_MODE=true` → code is always `123456` (`lib/otp/demoMode.ts`); no real WhatsApp required.

---

### Step 1 — Quotes (first WhatsApp contact)

| | |
|---|---|
| **Audience** | Guest |
| **Trigger** | OTP verified → `send_quotes` job (Edge) or `runDemoPostVerification` → `deliverQuoteWhatsApp` (demo) |
| **Template keys** | `quote_single_v1` (1 operator) or `quote_choice_v1` (2–3 operators, lowest first) |
| **MSG91 method** | **Utility bulk template** (cold start) with session interactive button fallback |
| **Code (copy)** | `lib/whatsapp/templateCatalog.ts` → `buildQuoteSingleMessage` / `buildQuoteChoiceMessage` |
| **Code (Edge send)** | `supabase/functions/_shared/handlers/sendQuotes.ts` |
| **Code (Next send)** | `lib/whatsapp/deliverQuoteWhatsApp.ts` → `sendWhatsAppMessage()` |
| **Code (MSG91 payload)** | `lib/msg91/pure.ts` → `buildMsg91BulkTemplateBody()` / `buildMsg91InteractiveButtonBody()` |

**Full message body (example, 3 vendors):**

```text
Your Kashmir cab quotes are in.

Trip: 3 days · 4 pax · Sedan · Srinagar → Pahalgam

• Nova Cabs ₹10,800/day (4.8)
• Ola Cabs ₹11,200/day (4.6)
• Valley Rides ₹11,400/day (4.5)

Lowest price is listed first.
```

**Footer:** `Tap a button below to choose your cab.`

**Quick-reply buttons (titles static at template approval):**

| Title | Payload (send-time) |
|-------|---------------------|
| Select {vendor 1} | `BOOK_TOKEN::{cheapest quote_snapshot_uuid}` |
| Select {vendor 2} | `BOOK_TOKEN::{second quote_snapshot_uuid}` |
| Select {vendor 3} | `BOOK_TOKEN::{third quote_snapshot_uuid}` |

**MSG91 JSON shape (bulk template send):**

```json
{
  "integrated_number": "124XXXXXXXXX",
  "content_type": "template",
  "payload": {
    "messaging_product": "whatsapp",
    "type": "template",
    "template": {
      "name": "quote_choice_v1",
      "language": { "code": "en_US", "policy": "deterministic" },
      "to_and_components": [{
        "to": ["919876543210"],
        "components": {
          "body_1": { "type": "text", "value": "3 days · 4 pax · Sedan · Srinagar → Pahalgam" },
          "body_2": { "type": "text", "value": "Nova Cabs ₹10,800/day (4.8)" },
          "body_3": { "type": "text", "value": "Ola Cabs ₹11,200/day (4.6)" },
          "body_4": { "type": "text", "value": "Valley Rides ₹11,400/day (4.5)" },
          "button_1": { "type": "text", "subtype": "quick_reply", "value": "BOOK_TOKEN::uuid-1" },
          "button_2": { "type": "text", "subtype": "quick_reply", "value": "BOOK_TOKEN::uuid-2" },
          "button_3": { "type": "text", "subtype": "quick_reply", "value": "BOOK_TOKEN::uuid-3" }
        }
      }]
    }
  }
}
```

**Guest action:** Tap Select {vendor} → webhook / demo API parses `BOOK_TOKEN::…` → `finalize_booking`.

**UI replay:** `features/demo/components/MockWhatsAppChat.tsx` reads Select buttons from `whatsapp_message_log.button_payload` via `lib/demo/mockMessaging.ts`.

---

### Step 2 — Nova booking notify (plain text)

| | |
|---|---|
| **Audience** | Nova / winning vendor |
| **Trigger** | Booking created (`finalize_quote_booking`) → `notify_vendor_booking` job |
| **Template key (log)** | `vendor_booking_notify_v1` |
| **MSG91 method** | **Session plain text** (not bulk template in code) |
| **Code (production Edge)** | `supabase/functions/_shared/handlers/notifyVendorBooking.ts` |
| **Code (demo Next)** | `lib/demo/postTokenBookingFlow.ts` → `deliverAndLogWhatsAppText()` |

**Production message** (`notifyVendorBooking.ts`):

```text
New booking confirmed 🎉
Route: Srinagar → Gulmarg
Date: 14 Aug, 3 days
Pax: 4 | Vehicle: Sedan
Price: ₹10800/day

Reply in this format to assign driver:
DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>

Example:
DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire
```

**Demo message** (includes guest name + phone — demo path only):

```text
New booking confirmed for Nova Cabs 🎉
Guest: Adil (+919876543210)
Route: Srinagar → Gulmarg
Date: 14 Aug, 3 days
Pax: 4 | Vehicle: Sedan
Agreed quote: ₹10,800/day

Reply in this format to assign driver:
DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>
```

**Recipient:** `vendors.whatsapp_number` for the winning quote’s vendor.

**Booking status after send:** `vendor_confirmed` → `driver_attach_pending`.

---

### Step 3 — Nova driver reply (inbound text)

| | |
|---|---|
| **Audience** | Nova (inbound) |
| **Trigger** | Vendor sends WhatsApp message matching `DRIVER:` format |
| **Template key (log)** | `vendor_inbound_driver_reply` (demo inbound log) |
| **MSG91 method** | Inbound (webhook) — not an outbound send |
| **Code (production)** | `lib/whatsapp/webhook/parseInboundAction.ts` → `parse_driver_details` job → `supabase/functions/_shared/handlers/parseDriverDetails.ts` |
| **Code (demo)** | `lib/demo/postTokenBookingFlow.ts` → `attachDemoDriver()` auto-fakes inbound |

**Expected inbound format:**

```text
DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire
```

**Regex:** `^DRIVER:\s*([^|]+?)\s*\|\s*(\+?\d{10,13})\s*\|\s*([A-Z0-9\- ]+?)\s*\|\s*(.+)$` (case-insensitive)

**Demo drivers by vendor** (`postTokenBookingFlow.ts` → `DEMO_VENDOR_DRIVERS`):

| Vendor | Driver | Phone |
|--------|--------|-------|
| Nova Cabs | Bilal Ahmed | 9876500001 |
| Ola Cabs | Rashid Khan | 9876500002 |
| Aala Cabs | Imran Dar | 9876500003 |
| Uber | Adil Mir | 9876500004 |

---

### Step 4 — Balance payment (interactive button)

| | |
|---|---|
| **Audience** | Guest |
| **Trigger** | After driver attached → `send_balance_payment` job (prod) or demo post-token flow |
| **Template key** | `driver_balance_v1` |
| **MSG91 method** | **Session interactive button** |
| **Code (copy)** | `lib/whatsapp/templateCatalog.ts` → `buildDriverBalanceMessage()` |
| **Code (Edge)** | `supabase/functions/_shared/handlers/sendBalancePayment.ts` |
| **Code (demo)** | `lib/demo/postTokenBookingFlow.ts` → `deliverAndLogWhatsAppSpec()` |

**Full message:**

```text
Your driver has been assigned 🚗
Operator: Nova Cabs

Balance due: ₹32,301 (after ₹99 token).
Complete payment here to unlock your driver's contact number.
```

**Button:**

| Title | Payload |
|-------|---------|
| `Pay ₹32,301 Now` (max 20 chars) | `COMPLETE_PAYMENT::{booking_uuid}` |

**Mock UI only:** Driver/car image card from `features/demo/constants/mockChatMedia.ts` — stored in log `button_payload.media`, **not** sent on real WhatsApp.

---

### Step 5 — Driver contact (plain text → guest)

| | |
|---|---|
| **Audience** | Guest |
| **Trigger** | Balance paid → `complete_balance_payment` |
| **Template key** | `driver_contact_v1` |
| **MSG91 method** | **Session plain text** (bulk template if env + namespace set and no buttons — see `sendWhatsAppMessage.ts`) |
| **Code (copy)** | `lib/whatsapp/templateCatalog.ts` → `buildDriverContactMessage()` |
| **Code (Edge)** | `supabase/functions/_shared/handlers/completeBalancePayment.ts` |
| **Code (demo)** | `lib/demo/postTokenBookingFlow.ts` → `runDemoCompleteBalancePayment()` |

**Full message:**

```text
Payment received ✅
Your driver: Bilal Ahmed
Call / WhatsApp: 9876500001
Vehicle: Sedan (JK01NO1234)
Operator: Nova Cabs
Driver will reach out before pickup. Safe travels!
```

---

### Step 6 — Driver assignment (plain text → driver)

| | |
|---|---|
| **Audience** | Driver (not Nova) |
| **Trigger** | Same as step 5 (`complete_balance_payment`) |
| **Template key** | `driver_assignment_v1` |
| **MSG91 method** | **Session plain text** |
| **Code (copy)** | `lib/whatsapp/templateCatalog.ts` → `buildDriverAssignmentMessage()` |
| **Code (Edge)** | `supabase/functions/_shared/handlers/completeBalancePayment.ts` |
| **Code (demo)** | `lib/demo/postTokenBookingFlow.ts` → `deliverDriverAssignment()` |

**Full message:**

```text
New ride assigned, Bilal Ahmed 🚗
Route: Srinagar → Gulmarg
Date: 14 Aug, 3 days
Guest: Adil (+919876543210)
Your vehicle: Sedan (JK01NO1234)
Please contact the guest before pickup. Safe drive!
```

**Recipient:** Driver phone from vendor’s `DRIVER:` reply (normalized to E.164 in `deliverAndLogOutbound.ts`).

**Not shown in guest mock chat** — filtered in `lib/demo/mockMessaging.ts` (`driver_assignment_v1` excluded from customer thread).

---

## Later lifecycle messages (production Edge)

Handler: `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts`

| Event | MSG91 method | Body (summary) | Buttons |
|-------|--------------|----------------|---------|
| `pre_pickup_reminder` | Session text | Reminder + driver/vehicle line | — |
| `day1_checkin` | Session button | "How was your pickup this morning?" | All Good / Report Issue |
| `midtrip_wellness` | Session button | "Everything going smoothly…?" | Yes, all good / Need Help |
| `post_trip_review` | Session button | "How was your trip?" | Excellent / Okay / Poor |

Button payloads: `CHECKIN_OK::{event_id}`, `CHECKIN_HELP::{event_id}`, `RATE_5::{booking_id}`, etc.

---

## Confirmation card (after driver details — alternate prod path)

| | |
|---|---|
| **Handler** | `supabase/functions/_shared/handlers/sendConfirmationCard.ts` |
| **Template key (dashboard)** | `customer_confirmation_v1` |
| **MSG91 method** | Session **image** + caption, or text if no image URL |

**Caption example:**

```text
Your Cab Is Confirmed ✅
Driver: Imran Dar
Vehicle: Amaze (JK01AA9012)
Pickup: 14 Aug, 09:00 — Srinagar
Vendor: Aala Cabs
```

---

## Inbound action payloads (guest / vendor taps)

Parsed in `lib/whatsapp/webhook/parseInboundAction.ts`:

| Payload prefix | Action |
|----------------|--------|
| `BOOK_TOKEN::{quote_snapshot_id}` | Lock booking (₹99 token) |
| `BOOK_FULL::{quote_snapshot_id}` | Full payment book (legacy) |
| `COMPLETE_PAYMENT::{booking_id}` | Mark balance paid |
| `NEGOTIATE::{quote_snapshot_id}` | Negotiation (removed from product UI) |
| `CHECKIN_OK::`, `CHECKIN_HELP::` | Lifecycle |
| `RATE_N::{booking_id}` | Trip rating |
| Free text `DRIVER:…` | Vendor driver details |

Demo equivalent: `app/api/demo/messaging/action/route.ts` → `lib/demo/mockMessaging.ts`.

---

## Demo vs production orchestration

| Step | Demo (`DEMO_MODE=true`) | Production |
|------|-------------------------|------------|
| OTP | Fixed `123456` | SMS SendOTP / WhatsApp template / Phone.Email |
| Quotes | `deliverQuoteWhatsApp` → MSG91 list or simulated | Edge `sendQuotes.ts` job worker |
| Post-₹99 flow | `runDemoPostTokenBookingFlow` (Next) | Edge jobs: `notify_vendor_booking`, `parse_driver_details`, `send_balance_payment`, `complete_balance_payment` |
| Nova DRIVER reply | Auto-faked inbound log | Real WhatsApp webhook |
| Payment | Status flags in DB | Webhook / API (gateway TBD) |
| Guest UI | `MockWhatsAppChat` ← log | Real WhatsApp on phone |
| Admin UI | `/admin/debug` → WhatsApp flow tab | Same log + live sends |

**Design goal:** Outbound messages use the same builders and MSG91 session APIs in demo and prod. Turning on MSG91 credentials should not require copy changes.

---

## File index

| Purpose | Path |
|---------|------|
| Message copy (canonical) | `lib/whatsapp/templateCatalog.ts` |
| Template keys | `lib/whatsapp/templateKeys.ts` |
| MSG91 template env resolver | `lib/whatsapp/templateEnv.ts` |
| Dashboard JSON catalog | `templates/msg91/whatsapp-templates.json` |
| MSG91 list/button/text builders | `lib/msg91/pure.ts` |
| Send routing | `lib/whatsapp/sendWhatsAppMessage.ts`, `lib/whatsapp/sendOutbound.ts` |
| Deliver + log | `lib/whatsapp/deliverAndLogOutbound.ts`, `lib/whatsapp/deliverQuoteWhatsApp.ts` |
| Log serialize/parse | `lib/whatsapp/messagePayload.ts` |
| Demo post-booking | `lib/demo/postTokenBookingFlow.ts` |
| Demo mock thread | `lib/demo/mockMessaging.ts` |
| Mock chat UI | `features/demo/components/MockWhatsAppChat.tsx` |
| Admin flow steps | `features/admin-debug/messagingFlow.ts` |
| Edge: quotes | `supabase/functions/_shared/handlers/sendQuotes.ts` |
| Edge: vendor notify | `supabase/functions/_shared/handlers/notifyVendorBooking.ts` |
| Edge: parse driver | `supabase/functions/_shared/handlers/parseDriverDetails.ts` |
| Edge: balance | `supabase/functions/_shared/handlers/sendBalancePayment.ts` |
| Edge: complete payment | `supabase/functions/_shared/handlers/completeBalancePayment.ts` |
| Edge: lifecycle | `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts` |
| Edge MSG91 client | `supabase/functions/_shared/msg91WhatsApp.ts` |

---

## Quick reference — MSG91 method per message

| # | Message | Template name | Bulk template send? | Session send |
|---|---------|---------------|---------------------|--------------|
| 0 | WhatsApp OTP | `otp_verification` | **Yes (only one wired)** | — |
| 1 | Quotes (2–3) | `quote_choice_v1` | **Yes (cold start)** | **Button fallback** |
| 1b | Quote (1 operator) | `quote_single_v1` | No (dynamic list id) | **List** |
| 2 | Nova notify | `vendor_booking_notify_v1` | No (in code) | **Text** |
| 3 | Nova DRIVER reply | — | — | Inbound |
| 4 | Balance | `driver_balance_v1` | No (dynamic button) | **Button** |
| 5 | Driver contact | `driver_contact_v1` | Optional fallback | **Text** |
| 6 | Driver assign | `driver_assignment_v1` | No (in code) | **Text** |
| + | Confirmation | `customer_confirmation_v1` | Optional | **Image/text** |
| + | Reminders / review | various | Optional | **Text/button** |

---

## Raw dashboard templates (paste into MSG91)

Create at **MSG91 → WhatsApp → Templates → Create Template**. Language: **`en_US`**. After Green approval, copy **name + namespace** from Code view into `.env`.

Source of truth JSON: [`templates/msg91/whatsapp-templates.json`](../templates/msg91/whatsapp-templates.json)

---

### 1. `otp_verification` — AUTHENTICATION

**Category:** Authentication · OTP + Copy code  
**Wired bulk send:** Yes — `lib/whatsapp/sendAuthTemplateOtp.ts`  
**Env:**

```env
MSG91_OTP_TEMPLATE_NAME=otp_verification
MSG91_OTP_TEMPLATE_NAMESPACE=
MSG91_OTP_TEMPLATE_LANGUAGE=en_US
```

**Raw template body (dashboard):**

```text
Your Kashmir BnB Cabs verification code is {{1}}. Do not share this code with anyone.
```

**Button:** Copy code (OTP)  
**Sample variables:** `{{1}}` = `123456`

**Code components at send time:**

```json
{
  "body_1": { "type": "text", "value": "123456" },
  "button_1": { "subtype": "url", "type": "text", "value": "123456" }
}
```

---

### 2. `quote_single_v1` — UTILITY

**Category:** Utility  
**Wired bulk send:** No today — **session list** (dynamic `BOOK_TOKEN::{uuid}`)  
**Env (optional, for future bulk):**

```env
MSG91_QUOTE_SINGLE_TEMPLATE_NAME=quote_single_v1
MSG91_QUOTE_SINGLE_TEMPLATE_NAMESPACE=
```

**Raw template body (dashboard):**

```text
Your Kashmir Cab Quote 🚖

{{1}}: ₹{{2}}/day ({{3}})
```

**Button (dashboard label only):** Quick reply · `Pay ₹99 to Lock`  
**Sample variables:**

| Var | Example |
|-----|---------|
| `{{1}}` | Aala Cabs |
| `{{2}}` | 17500 |
| `{{3}}` | Amaze |

**Code `msg91Components` (if bulk used):** `body_1` vendor, `body_2` price, `body_3` vehicle — see `buildQuoteSingleMessage()` in `templateCatalog.ts`.

---

### 3. `quote_choice_v1` — UTILITY (first contact, 3 quote buttons)

**Catalog:** `templates/msg91/whatsapp-templates.json`. Runtime uses **bulk template** (cold start) with session interactive fallback.

**Raw template body (dashboard):**

```text
Your Kashmir cab quotes are in.

Trip: {{1}}

• {{2}}
• {{3}}
• {{4}}

Lowest price is listed first.
```

**Footer:** `Tap a button below to choose your cab.`

**Buttons:** Quick reply · `Select {vendor_1}` · `Select {vendor_2}` · `Select {vendor_3}` (titles truncated to 20 chars at send time)

**Sample variables:**

| Var | Example |
|-----|---------|
| `{{1}}` | 3 days · 4 pax · Sedan · Srinagar → Pahalgam |
| `{{2}}` | Nova Cabs ₹10,800/day (4.8) |
| `{{3}}` | Ola Cabs ₹11,200/day (4.6) |
| `{{4}}` | Valley Rides ₹11,400/day (4.5) |

**Code `msg91Components`:** `body_1` trip, `body_2`–`body_4` quote lines, `button_1`–`button_3` `BOOK_TOKEN::` payloads — see `buildQuoteChoiceMessage()`.

**Env:**

```env
MSG91_QUOTE_CHOICE_TEMPLATE_NAME=quote_choice_v1
MSG91_QUOTE_CHOICE_TEMPLATE_NAMESPACE=
```

---

### 4. `quote_multi_v1` — UTILITY (legacy multi-line list)

**Not the first-contact path anymore.** Kept for single-operator list fallbacks and older logs. Runtime used **session list**.

**Raw template body (if registered):**

```text
Your Kashmir Cab Quotes Are In 🚖

{{1}}
```

**Sample `{{1}}` (all vendor lines, newline-separated):**

```text
Nova Cabs: ₹10,800/day (Sedan)
Ola Cabs: ₹11,200/day (Sedan)
```

**Env:**

```env
MSG91_QUOTE_MULTI_TEMPLATE_NAME=quote_multi_v1
MSG91_QUOTE_MULTI_TEMPLATE_NAMESPACE=
```

---

### 4. `driver_balance_v1` — UTILITY

**Wired bulk send:** No today — **session button** (dynamic `Pay ₹X Now`)  
**Env:**

```env
MSG91_DRIVER_BALANCE_TEMPLATE_NAME=driver_balance_v1
MSG91_DRIVER_BALANCE_TEMPLATE_NAMESPACE=
```

**Raw template body (dashboard):**

```text
Your driver has been assigned 🚗
Operator: {{1}}
Balance due: ₹{{2}} (after ₹99 token).
Complete payment here to unlock your driver's contact number.
```

**Button:** Quick reply · `Pay balance Now` (dashboard); runtime title is dynamic e.g. `Pay ₹32,301 Now`  
**Sample variables:** `{{1}}` = Aala Cabs, `{{2}}` = 17501

**Code `msg91Components`:** `body_1` operator, `body_2` balance amount — `buildDriverBalanceMessage()`.

---

### 5. `vendor_booking_notify_v1` — UTILITY

**Wired bulk send:** No today — **session text**  
**Env:**

```env
MSG91_VENDOR_NOTIFY_TEMPLATE_NAME=vendor_booking_notify_v1
MSG91_VENDOR_NOTIFY_TEMPLATE_NAMESPACE=
```

**Raw template body (dashboard):**

```text
New booking confirmed 🎉
Route: {{1}} → {{2}}
Date: {{3}}, {{4}} {{5}}
Pax: {{6}} | Vehicle: {{7}}
Price: ₹{{8}}/day

Reply in this format to assign driver:
DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>

Example:
DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire
```

**Buttons:** none  
**Sample variables:**

| Var | Example |
|-----|---------|
| `{{1}}` | Srinagar |
| `{{2}}` | Pahalgam |
| `{{3}}` | 14 Aug |
| `{{4}}` | 3 |
| `{{5}}` | days |
| `{{6}}` | 4 |
| `{{7}}` | Sedan |
| `{{8}}` | 2420 |

---

### 6. `driver_contact_v1` — UTILITY

**Wired bulk send:** Optional fallback when namespace env set — else session text  
**Env:**

```env
MSG91_DRIVER_CONTACT_TEMPLATE_NAME=driver_contact_v1
MSG91_DRIVER_CONTACT_TEMPLATE_NAMESPACE=
```

**Raw template body (dashboard):**

```text
Payment received ✅
Your driver: {{1}}
Call / WhatsApp: {{2}}
Vehicle: {{3}} ({{4}})
Operator: {{5}}
Driver will reach out before pickup. Safe travels!
```

**Sample variables:** driver name, phone, model, plate, vendor — see `buildDriverContactMessage()` → `body_1`…`body_5`.

---

### 7. `driver_assignment_v1` — UTILITY

**Wired bulk send:** No today — **session text** to driver phone  
**Env:**

```env
MSG91_DRIVER_ASSIGNMENT_TEMPLATE_NAME=driver_assignment_v1
MSG91_DRIVER_ASSIGNMENT_TEMPLATE_NAMESPACE=
```

**Raw template body (dashboard):**

```text
New ride assigned, {{1}} 🚗
Route: {{2}} → {{3}}
Date: {{4}}, {{5}} {{6}}
Guest: {{7}} ({{8}})
Your vehicle: {{9}} ({{10}})
Please contact the guest before pickup. Safe drive!
```

**Sample variables:** driver name, pickup, drop, date, days count, day/days label, guest label, guest phone, vehicle model, plate.

---

### 8. `customer_confirmation_v1` — UTILITY

**Header:** IMAGE (public HTTPS URL)  
**Env:**

```env
MSG91_CONFIRMATION_TEMPLATE_NAME=customer_confirmation_v1
MSG91_CONFIRMATION_TEMPLATE_NAMESPACE=
```

**Raw template body (dashboard):**

```text
Your Cab Is Confirmed ✅
Driver: {{1}}
Vehicle: {{2}} ({{3}})
Pickup: {{4}} — {{5}}
Vendor: {{6}}
```

---

### 9. `pre_pickup_reminder_v1` — UTILITY

**Env:**

```env
MSG91_PRE_PICKUP_TEMPLATE_NAME=pre_pickup_reminder_v1
MSG91_PRE_PICKUP_TEMPLATE_NAMESPACE=
```

**Raw template body (dashboard):**

```text
Reminder: your Kashmir cab pickup is tomorrow 🚗
{{1}}
Need help? Reply to this message and our support team will assist.
```

**Sample `{{1}}:** `Driver: Imran Dar, Vehicle: Amaze (JK01AA9012)`

---

## Raw API payloads (what code actually POSTs)

Headers for all MSG91 WhatsApp calls:

```http
accept: application/json
authkey: <MSG91_AUTH_KEY>
content-type: application/json
```

---

### Bulk template send (Send WhatsApp template)

**URL:** `POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/`

**Example — OTP (`otp_verification`):**

```json
{
  "integrated_number": "919111111111",
  "content_type": "template",
  "payload": {
    "messaging_product": "whatsapp",
    "type": "template",
    "template": {
      "name": "otp_verification",
      "namespace": "<from MSG91 dashboard after Green>",
      "language": { "code": "en_US", "policy": "deterministic" },
      "to_and_components": [
        {
          "to": ["919876543210"],
          "components": {
            "body_1": { "type": "text", "value": "123456" },
            "button_1": { "subtype": "url", "type": "text", "value": "123456" }
          }
        }
      ]
    }
  }
}
```

**Built by:** `buildMsg91BulkTemplateBody()` → `sendMsg91TemplateWithConfig()` in `lib/msg91/pure.ts`.

**Example — driver contact (if bulk fallback used):**

```json
{
  "integrated_number": "919111111111",
  "content_type": "template",
  "payload": {
    "messaging_product": "whatsapp",
    "type": "template",
    "template": {
      "name": "driver_contact_v1",
      "namespace": "<namespace>",
      "language": { "code": "en_US", "policy": "deterministic" },
      "to_and_components": [
        {
          "to": ["919876543210"],
          "components": {
            "body_1": { "type": "text", "value": "Imran Dar" },
            "body_2": { "type": "text", "value": "9876500003" },
            "body_3": { "type": "text", "value": "Amaze" },
            "body_4": { "type": "text", "value": "JK01AA9012" },
            "body_5": { "type": "text", "value": "Aala Cabs" }
          }
        }
      ]
    }
  }
}
```

---

### Session interactive list (quotes — what we use today)

**URL:** `POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/`

**No dashboard template.** Built by `buildMsg91InteractiveListBody()`.

```json
{
  "recipient_number": "919876543210",
  "integrated_number": "919111111111",
  "content_type": "interactive",
  "interactive": {
    "type": "list",
    "body": {
      "text": "Your Kashmir Cab Quotes Are In 🚖\n\nNova Cabs: ₹10,800/day (Sedan)\nOla Cabs: ₹11,200/day (Sedan)"
    },
    "action": {
      "button": "Choose operator",
      "sections": [
        {
          "title": "Pay ₹99 to lock",
          "rows": [
            {
              "id": "BOOK_TOKEN::550e8400-e29b-41d4-a716-446655440000",
              "title": "Nova Cabs",
              "description": "₹10,800/day · Sedan"
            },
            {
              "id": "BOOK_TOKEN::660e8400-e29b-41d4-a716-446655440001",
              "title": "Ola Cabs",
              "description": "₹11,200/day · Sedan"
            }
          ]
        }
      ]
    }
  }
}
```

**Code:** `sendMsg91InteractiveListWithConfig()` → `sendWhatsAppListMessage()` → `deliverQuoteWhatsApp()`.

---

### Session interactive button (balance payment)

```json
{
  "recipient_number": "919876543210",
  "integrated_number": "919111111111",
  "content_type": "interactive",
  "interactive": {
    "type": "button",
    "body": {
      "text": "Your driver has been assigned 🚗\nOperator: Nova Cabs\n\nBalance due: ₹32,301 (after ₹99 token).\nComplete payment here to unlock your driver's contact number."
    },
    "action": {
      "buttons": [
        {
          "type": "reply",
          "reply": {
            "id": "COMPLETE_PAYMENT::booking-uuid-here",
            "title": "Pay ₹32,301 Now"
          }
        }
      ]
    }
  }
}
```

**Built by:** `buildMsg91InteractiveButtonBody()` in `lib/msg91/pure.ts`.

---

### Session plain text (Nova notify, driver assign, driver contact)

**URL:** `POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/?integrated_number=…&recipient_number=…&content_type=text&text=…`

Or equivalent JSON body path via `sendMsg91TextWithConfig()`.

**Example body (Nova — production copy):**

```text
New booking confirmed 🎉
Route: Srinagar → Gulmarg
Date: 14 Aug, 3 days
Pax: 4 | Vehicle: Sedan
Price: ₹10800/day

Reply in this format to assign driver:
DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>

Example:
DRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire
```

**Code:** `deliverAndLogWhatsAppText()` / `notifyVendorBooking.ts` → `sendWhatsAppTextMessage()`.

---

## Session-only messages (no dashboard template)

These are **not** created in MSG91 dashboard — only sent via session API. Specs in `whatsapp-templates.json` → `sessionInteractiveMessages`:

| Name | Method | Key payload |
|------|--------|-------------|
| `quote_multi_list` | List | Row id `BOOK_TOKEN::{quote_snapshot_id}` |
| `driver_balance_payment` | Button | `COMPLETE_PAYMENT::{booking_id}` |
| `day1_checkin` | Button | `CHECKIN_OK::{event_id}`, `CHECKIN_HELP::{event_id}` |
| `post_trip_review` | Button | `RATE_5::{booking_id}`, etc. |

---

## Deprecated dashboard templates (do not create)

From `whatsapp-templates.json` → `deprecated`:

- `quote_consolidated_v1` (3-button Book / Negotiate / Pay)
- `negotiation_offer_v1`
- `negotiation_final_v1`
