# MSG91 WhatsApp dashboard templates — Kashmir BnB Cabs

**Create at:** MSG91 → WhatsApp → Templates → Create Template  
**Language:** `en_US`  
**After Green approval:** copy **name + namespace** from the template **Code** view into `.env.local`

**Print full specs:** `npm run msg91:templates`  
**Print env block:** `npm run msg91:templates -- --env`  
**List remote templates:** `npm run msg91:templates -- --list` (needs `MSG91_AUTH_KEY` + integrated number)

Machine-readable catalog: [`templates/msg91/whatsapp-templates.json`](../templates/msg91/whatsapp-templates.json)

---

## Two send types (important)

| Type | When | Dashboard template? | How code sends |
|------|------|---------------------|----------------|
| **Bulk template** | OTP, vendor notify, reminders | **Yes — create in dashboard** | `POST …/whatsapp-outbound-message/bulk/` |
| **Session interactive** | Quote Pay ₹99, balance payment, check-in | **No** — dynamic button IDs | `POST …/whatsapp-outbound-message/` interactive API |

Button payloads like `BOOK_TOKEN::{quote_snapshot_id}` are **not** typed into the dashboard — only button **titles** appear in Utility templates. Because our IDs are dynamic per booking, quotes and payments use the **session interactive API** (already wired in code).

**Demo mode** simulates messages in-app — it does not call MSG91. Templates below are for **production**.

---

## P0 — Create first

### 1. `otp_verification` — Authentication

**Category:** Authentication · **OTP + Copy code** (not Utility)

**Body:**
```
Your Kashmir BnB Cabs verification code is {{1}}. Do not share this code with anyone.
```

**Button:** Copy code  
**Sample {{1}}:** `123456`

**Env after Green:**
```env
MSG91_OTP_TEMPLATE_NAME=otp_verification
MSG91_OTP_TEMPLATE_NAMESPACE=<from MSG91 code view>
MSG91_OTP_TEMPLATE_LANGUAGE=en_US
```

**Wired in:** `lib/whatsapp/sendAuthTemplateOtp.ts`

---

### 2. `quote_choice_v1` — first WhatsApp contact (Utility + 3 quick replies)

Sent right after the tourist submits a phone number at the end of the cab-quote flow. Default OTP is SMS, so this is usually a **cold start** and **must** be an approved Utility template (session interactive only works inside a 24h window).

**MSG91 / Meta limits that shape this template:**

- Quick-reply **titles are static** at approval (max **3**, each ≤ **20** chars). Vendor names cannot go on the buttons.
- Footer ≤ **60** chars. Body ≤ **1024** and must not start or end with a variable.
- Dynamic `BOOK_TOKEN::{quote_snapshot_id}` values are sent at **send time** as `button_1`…`button_3` (`subtype: quick_reply`), not typed into the dashboard.

**Body (paste in MSG91 dashboard):**
```
Your Kashmir cab quotes are in.

Trip: {{1}}

• {{2}}
• {{3}}
• {{4}}

Lowest price is listed first.
```

**Footer:** `Tap a button below to choose your cab.`

**Buttons (Quick Reply):**

| Title | Send-time payload (code only) |
|-------|-------------------------------|
| Select {vendor 1} | `BOOK_TOKEN::{cheapest quote_snapshot_id}` |
| Select {vendor 2} | `BOOK_TOKEN::{second quote_snapshot_id}` |
| Select {vendor 3} | `BOOK_TOKEN::{third quote_snapshot_id}` |

| Var | Sample |
|-----|--------|
| {{1}} | 3 days · 4 pax · Sedan · Srinagar → Pahalgam |
| {{2}} | Aala Cabs ₹17,500/day (4.8) |
| {{3}} | Nova Cabs ₹18,000/day (4.6) |
| {{4}} | Valley Rides ₹18,400/day (4.5) |

**Create API:** `POST https://api.msg91.com/api/v5/whatsapp/client-panel-template/` (MSG91 docs omit the JSON body and point at Facebook WABA components). Spec + builder: `lib/whatsapp/quoteChoiceTemplate.ts`.

**Env after Green:**
```env
MSG91_QUOTE_CHOICE_TEMPLATE_NAME=quote_choice_v1
MSG91_QUOTE_CHOICE_TEMPLATE_NAMESPACE=<from MSG91 code view>
```

**Wired in:** `lib/whatsapp/buildQuoteDelivery.ts` → `buildQuoteChoiceMessage`

**Do not create** `quote_consolidated_v1` with Book/Negotiate/Pay — negotiate was removed.

---

### 3. Driver assigned + balance — session interactive (no dashboard template)

**Body (example):**
```
Your driver has been assigned 🚗
Operator: Aala Cabs
Balance due: ₹17,501 (after ₹99 token).
Complete payment here to unlock your driver's contact number.
```

**Button:**

| Title | Payload |
|-------|---------|
| Pay ₹17,501 Now | `COMPLETE_PAYMENT::{booking_id}` |

**Note:** Driver photo + car image in mock chat is **demo UI only** — not an MSG91 template.

**Wired in:** `lib/demo/postTokenBookingFlow.ts` (demo + production path)

---

## P1 — Vendor ops

### 4. `vendor_booking_notify_v1` — Utility (no buttons)

**Body:**
```
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

| Var | Sample |
|-----|--------|
| {{1}} | Srinagar |
| {{2}} | Pahalgam |
| {{3}} | 14 Aug |
| {{4}} | 3 |
| {{5}} | days |
| {{6}} | 4 |
| {{7}} | Sedan |
| {{8}} | 2420 |

**Env (optional, when wired):**
```env
MSG91_VENDOR_NOTIFY_TEMPLATE_NAME=vendor_booking_notify_v1
MSG91_VENDOR_NOTIFY_TEMPLATE_NAMESPACE=
```

---

## P2 — Lifecycle & confirmation

### 5. `customer_confirmation_v1` — Utility

Optional **IMAGE** header (public HTTPS URL).

**Body:**
```
Your Cab Is Confirmed ✅
Driver: {{1}}
Vehicle: {{2}} ({{3}})
Pickup: {{4}} — {{5}}
Vendor: {{6}}
```

### 6. `pre_pickup_reminder_v1` — Utility (no buttons)

**Body:**
```
Reminder: your Kashmir cab pickup is tomorrow 🚗
{{1}}
Need help? Reply to this message and our support team will assist.
```

`{{1}}` = `Driver: Imran Dar, Vehicle: Amaze (JK01AA9012)` or `Driver details are being finalized.`

### 7. `driver_contact_v1` — Utility (no buttons)

**Body:**
```
Payment received ✅
Your driver: {{1}}
Call / WhatsApp: {{2}}
Vehicle: {{3}} ({{4}})
Operator: {{5}}
Driver will reach out before pickup. Safe travels!
```

---

## P3 — Session interactive (lifecycle buttons)

Create **no dashboard template** — code sends via interactive API when session is open.

| Message | Body | Buttons |
|---------|------|---------|
| Day-1 check-in | How was your pickup this morning? | All Good · Report Issue |
| Mid-trip wellness | Everything going smoothly on your trip so far? | Yes, all good · Need Help |
| Post-trip review | How was your trip? Tap a rating below. | Excellent · Okay · Poor |

Payloads: `CHECKIN_OK::{lifecycle_event_id}`, `CHECKIN_HELP::…`, `RATE_5::{booking_id}`, etc.

---

## Deprecated — do not create

- `quote_consolidated_v1` (Book / Negotiate / Pay ₹99 — old 3-button flow)
- `negotiation_offer_v1`
- `negotiation_final_v1`

Negotiate was removed from the customer flow.

---

## Required env (production)

```env
MSG91_AUTH_KEY=
MSG91_WHATSAPP_INTEGRATED_NUMBER=
MSG91_OTP_TEMPLATE_NAME=otp_verification
MSG91_OTP_TEMPLATE_NAMESPACE=
MSG91_OTP_TEMPLATE_LANGUAGE=en_US
MSG91_OTP_TEMPLATE_ID=          # SMS SendOTP (separate from WhatsApp template)
```

Set Edge secrets too: `supabase secrets set --env-file .env.local`

---

## Approval checklist

| Template | Category | Status | Namespace in .env |
|----------|----------|--------|-------------------|
| otp_verification | Authentication | ☐ Green | ☐ |
| vendor_booking_notify_v1 | Utility | ☐ Green | ☐ |
| customer_confirmation_v1 | Utility | ☐ Green | ☐ |
| pre_pickup_reminder_v1 | Utility | ☐ Green | ☐ |
| driver_contact_v1 | Utility | ☐ Green | ☐ |
| Quote Pay ₹99 | Session interactive | N/A (code) | — |
| Balance payment | Session interactive | N/A (code) | — |
