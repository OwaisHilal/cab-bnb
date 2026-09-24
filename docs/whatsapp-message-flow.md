# WhatsApp message flow — filled examples

One sample trip, every live WhatsApp we send, in order. Dashboard paste specs live in [`msg91-whatsapp-dashboard-templates.md`](./msg91-whatsapp-dashboard-templates.md).

**Sample trip (used in every example below)**

| Field | Value |
|---|---|
| Guest | Abdul Rahman · `+91 98765 43210` |
| Route | Srinagar Airport → Pahalgam |
| Pickup | 10 Sep 2026, 7:30 AM IST |
| Trip | 2 days · 2 pax · Innova |
| Quotes (lowest first) | Aala Cabs ₹8,800/day (4.8) · Nova Cabs ₹9,200/day (4.5) · Valley Rides ₹9,500/day (4.2) |
| Chosen operator | Aala Cabs |
| Money | Total ₹17,600 · Token ₹99 · Balance ₹17,501 |
| Driver | Irfan Bhat · `9876500001` · Toyota Innova `JK01AA1111` |
| Booking ref | `ABC123` |
| Ride group invite | `https://chat.whatsapp.com/AbCdEfGhIjK` |

---

## Flow

```text
Guest submits phone
        │
        ▼
 1. OTP  (SMS first; WhatsApp if prefer=whatsapp)
        │
        ▼
 2. Quote card  (quote_choice_v1)  ── guest taps a vendor ──►
        │
        ▼
 3. Token pay ₹99  (token_lock_payment_v1)
        │  Cashfree success
        ├──────────────────────────────► 4. Token received  (guest)
        └──────────────────────────────► 5. Assign driver   (vendor)
                                                    │
                                    vendor taps "Assign driver" (web form)
                                    or replies a 10-digit phone /
                                    DRIVER: name | phone | number | model
                                                    │
                                                    ▼
                                         6. Balance pay  (guest)
                                                    │  Cashfree success
                     ┌──────────────────────────────┼──────────────────────────────┐
                     ▼                              ▼                              ▼
           7. Driver contact              8. Driver assignment           9–10. Ride group
              (guest)                        (driver)                    invites + welcome
                     │
                     └──────── lifecycle ────────► 11. T−12h reminder
                                                   12. T+2h check-in
                                                   13. Mid-trip (3+ day trips)
                                                   14. Post-trip review
                                                   Group deleted at pickup + trip days + 24h
```

**How we send**

| Style | What it is | Typical use |
|---|---|---|
| Bulk template | Approved MSG91/Meta template | OTP, first quote, token ack, vendor notify, ride-group invite |
| Session interactive | 24h window: list, buttons, payment_link, CTA URL | Token/balance pay, quote fallback, check-in/review |
| Session text / image | Plain chat (optional image) | Driver contact, confirmation, group welcome |

Utility templates **cannot** carry live `BOOK_TOKEN::{uuid}` or Pay Now amounts. Those go on **session** messages.

---

## 1. OTP — `otp_verification`

**To:** Guest · **Trigger:** `POST /api/otp/send` with `prefer=whatsapp` (SMS is the default)

**Filled example**

```
Your Kashmir BnB Cabs verification code is 482917. Do not share this code with anyone.
```

| Piece | What |
|---|---|
| Fixed | Surrounding sentence |
| Variable | `{{1}}` = OTP code (`482917`) |
| Buttons | Copy code (same code in the URL button) |
| Media | None |

---

## 2. Quotes — `quote_choice_v1`

**To:** Guest · **Trigger:** Quotes matched / `send_quotes` (first WhatsApp after phone verify)

Usually a **cold start**, so this is a Utility bulk template. If a 24h session already exists, code can fall back to 3 session quick-replies with live vendor names.

**Filled example**

```
Your Kashmir cab quotes are in.

Trip: 2 days · 2 pax · Innova · Srinagar Airport → Pahalgam

• Aala Cabs ₹8,800/day (4.8)
• Nova Cabs ₹9,200/day (4.5)
• Valley Rides ₹9,500/day (4.2)

Lowest price is listed first.
```

Footer: `Tap a button below to choose your cab.`

| Piece | What |
|---|---|
| Fixed | Opening/closing lines, bullets, footer |
| Variables | `{{1}}` trip summary · `{{2}}–{{4}}` quote lines (pad with `—` if fewer than 3) |
| Buttons | 3 quick replies. Dashboard titles are static (`Option 1/2/3`). Session fallback titles: `Select Aala Cabs`, `Select Nova Cabs`, `Select Valley Ride` (max 20 chars). Payload at send time: `BOOK_TOKEN::{quote_snapshot_id}` |
| Media | None |

**Fallbacks (same trigger, session only)**

- `quote_single_v1` — one vendor + list row `BOOK_TOKEN::…`
- `quote_multi_v1` — several vendors as a list (`Choose operator`)

Guest tap on a quote → job `send_token_payment_link`.

---

## 3. Token lock — `token_lock_payment_v1`

**To:** Guest · **Trigger:** Guest chose a vendor (`BOOK_TOKEN::`)

**Not** a dashboard Utility template. Session `payment_link` (Cashfree). Cart item is always **₹99 × 1**.

**Filled example**

```
Lock this cab with a ₹99 token.

Trip: 2 days · 2 pax · Innova · Srinagar Airport → Pahalgam
Aala Cabs ₹8,800/day (4.8)
Total: ₹17,600 · Token: ₹99 · Balance: ₹17,501

Days
• Day 1 · 10 Sep
• Day 2 · 11 Sep
```

Footer: `Pay ₹99 to lock this cab.`  
Pay item name: `Token lock · Aala Cabs · 2 days`

| Piece | What |
|---|---|
| Fixed | “Lock this cab…”, Token ₹99, “Days” header, footer |
| Variables | Trip summary, vendor line, total, balance, day lines |
| Buttons | Native WhatsApp Pay (Cashfree), not a custom QR |
| Media | None |

---

## 4. Token received — `token_received_v1`

**To:** Guest · **Trigger:** ₹99 paid → `send_token_received_ack`  
Bulk Utility, session text fallback.

**Filled example**

```
Payment received. Your ₹99 token is confirmed.

Trip: 2 days · 2 pax · Innova · Srinagar Airport → Pahalgam
Operator: Aala Cabs

We are allocating a driver for you. This can take about 30 minutes.
```

| Piece | What |
|---|---|
| Fixed | Payment / allocating-driver sentences |
| Variables | `{{1}}` trip summary · `{{2}}` operator name |
| Buttons / media | None |

Same payment also starts **vendor notify** (next).

---

## 5. Assign driver — `vendor_assign_driver_v1` (MSG91 name `vendor_assign_driver_v3`)

**To:** Vendor (Aala Cabs) · **Trigger:** Token or full lock → `notify_vendor_booking`  
The MSG91-side template is `vendor_assign_driver_v3` (approved 2026-09-24),
which keeps the same 9 body variables and the real **"Assign driver" URL
button** from v2 — `button_1` carries the signed vendor-assign token as the
button's dynamic suffix — but simplifies the trailing CTA sentence, dropping
the long `Optional: DRIVER: <name> | <phone> | ...` line in favor of one
line that also mentions the button. Session
**`cta_url`** ("Assign driver" button, same web form) remains the
fallback whenever the bulk send is skipped or fails
(`MSG91_USE_APPROVED_TEMPLATES` off, MSG91 not configured, or the
template send itself fails). See
`docs/2026-09-21-vendor-assign-driver-v2-template.md` for how v2 was
created, approved, and wired.

**Filled example — bulk Utility (cold start, now with an "Assign driver" button)**

```
New booking confirmed.

Guest: Abdul Rahman
Route: Srinagar Airport → Pahalgam
Date: 10 Sep, 2 days
Pax: 2 | Cab: Innova
Total: ₹17,600

Reply with the driver's 10-digit mobile to assign.
Optional: DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>
```

| Piece | What |
|---|---|
| Fixed | “New booking confirmed.”, reply instructions |
| Variables | Guest, pickup, drop, date, days, day/days, pax, cab type, total (`body_1`…`body_9`) |
| Buttons / media | One URL button, "Assign driver" (`button_1` = signed token, template URL fixed as `.../vendor/assign-driver?token={{1}}`) |

**Filled example — session fallback (interactive)**

Same body as above, plus an appended line and a real `cta_url` button:

```
… (same body as above) …

Fastest way: tap "Assign driver" below to submit details from your phone.
```

`[Assign driver]` → `app/vendor/assign-driver?token=<signed, expiring HMAC token>`
(`lib/whatsapp/vendorAssignToken.ts`, 72h TTL) — a mobile form for driver
name, phone, vehicle number, vehicle model. Submits to
`POST /api/vendor/assign-driver`, which calls the same
`assignDriverToBooking` helper as the free-text path below, so either way
produces an identical booking/job outcome.

**Inbound free-text (still supported as a fallback):** vendor texts
`9876500001` or  
`DRIVER: Irfan Bhat | 9876500001 | JK01AA1111 | Toyota Innova`  
→ `parse_driver_details` → balance pay to guest.

Demo/legacy copies: `vendor_booking_notify_v1` / `vendor_booking_notify_demo` (same idea, session text).

---

## 6. Balance pay — `driver_assigned_payment_v1`

**To:** Guest · **Trigger:** Driver parsed on a token booking → `send_balance_payment`  
Session `payment_link`. Cart item = remaining balance × 1.

**Filled example**

```
Your driver has been assigned.

Trip: 2 days · 2 pax · Innova · Srinagar Airport → Pahalgam
Aala Cabs ₹8,800/day (4.8)
Driver: Irfan Bhat · Toyota Innova (JK01AA1111)
Total: ₹17,600 · Token paid: ₹99 · Balance: ₹17,501
```

Footer: `Pay remaining balance to confirm.`  
Pay item name: `Balance · Aala Cabs · 2 days`

| Piece | What |
|---|---|
| Fixed | Opening line, “Token paid: ₹99”, footer |
| Variables | Trip, vendor line, driver + vehicle, total, balance |
| Buttons | Native Pay (Cashfree) |
| Media | None |

Older path `driver_balance_v1` uses session buttons (`Pay ₹17,501 Now` / `BALANCE_PAY::`) instead of a payment_link.

---

## 7. Driver contact — `driver_contact_v1`

**To:** Guest · **Trigger:** Balance paid (or full-pay confirm) → `complete_balance_payment`  
Session text. Demo may attach a driver-card image.

**Filled example**

```
Payment received ✅
Your driver: Irfan Bhat
Call / WhatsApp: 9876500001
Vehicle: Toyota Innova (JK01AA1111)
Operator: Aala Cabs
Driver will reach out before pickup. Safe travels!
```

| Piece | What |
|---|---|
| Fixed | “Payment received”, last line |
| Variables | Driver name, phone, vehicle model, number, operator |
| Buttons | None |
| Media | Optional driver-card image (demo / confirmation path) |

---

## 8. Driver assignment — `driver_assignment_v1`

**To:** Driver · **Trigger:** Same moment as #7  
Session text.

**Filled example**

```
New ride assigned, Irfan Bhat 🚗
Route: Srinagar Airport → Pahalgam
Date: 10 Sep, 2 days
Guest: Abdul Rahman (9876543210)
Your vehicle: Toyota Innova (JK01AA1111)
Please contact the guest before pickup. Safe drive!
```

| Piece | What |
|---|---|
| Fixed | Opening/closing lines |
| Variables | Driver name, route, date, days, guest name + phone, vehicle |
| Buttons / media | None |

---

## 9–10. Ride WhatsApp group

**Trigger:** Booking is `fully_paid` **and** `ready_for_pickup` → `create_ride_group`  
(Not on payment alone.) API cannot add people; they tap Join. `auto_approve`.  
`remind_ride_group_join` (+30 min) re-sends the same invites if someone has not joined.

### 9. Guest invite — `ride_group_guest_v1`

Bulk Utility with CTA URL `https://chat.whatsapp.com/{{1}}`, then session CTA, then plain text with the link.

**Filled example**

```
Your driver is connected.

We've created a private WhatsApp group for this ride with your driver.
Joining helps us quality-control the trip and keep an eye on communication.

Ride: ABC123
Pickup: 10 Sep, 7:30 AM · Srinagar Airport

Join the ride group: https://chat.whatsapp.com/AbCdEfGhIjK
```

Footer: `Kashmir BnB Cabs`

| Piece | What |
|---|---|
| Fixed | Connected / quality-control copy, footer |
| Variables | Booking ref, pickup line; button URL suffix = invite code `AbCdEfGhIjK` |
| Buttons | CTA **Join ride group** → invite link |
| Media | None |

### 10. Driver invite — `ride_group_driver_v1`

Same send ladder, to the driver.

**Filled example**

```
New ride assigned.

Passenger: Abdul Rahman
Pickup: 10 Sep, 7:30 AM · Srinagar Airport

We've created a WhatsApp group with the passenger for this ride.
Joining helps us quality-control the trip and keep an eye on communication.

Join the ride group: https://chat.whatsapp.com/AbCdEfGhIjK
```

| Piece | What |
|---|---|
| Fixed | Assigned / quality-control copy, footer |
| Variables | Guest name, pickup line, invite code on the button |
| Buttons | CTA **Join ride group** |
| Media | None |

### Group welcome (posted **in the group**, not 1:1)

**Trigger:** Group created. Session text to the group.

```
Welcome to ride ABC123.

Passenger: Abdul Rahman
Driver: Irfan Bhat
Vehicle: Toyota Innova (JK01AA1111)
Pickup: 10 Sep, 7:30 AM · Srinagar Airport

Please use this group only for this ride. Kashmir BnB is here to quality-control communication. The group closes automatically after the trip.
```

Group name (max 128): `Ride ABC123 · Abdul · Aala Cabs`  
Delete job: pickup time + trip days + 24h.

---

## Confirmation card — `customer_confirmation_v1`

**To:** Guest · **Trigger:** `send_confirmation_card` (full-pay / Edge path; may also enqueue the ride group)  
Session image + caption, or text if no image.

**Filled example**

```
Your Cab Is Confirmed ✅
Driver: Irfan Bhat
Vehicle: Toyota Innova (JK01AA1111)
Pickup: 10 Sep, 7:30 AM — Srinagar Airport
Vendor: Aala Cabs
```

| Piece | What |
|---|---|
| Fixed | Title line |
| Variables | Driver, vehicle, pickup time + place, vendor |
| Buttons | None |
| Media | Confirmation / driver-card image when a URL exists |

---

## Lifecycle (guest, session)

Scheduled once at confirm. Not dashboard templates.

| # | When | Copy | Buttons |
|---|---|---|---|
| 11 | **T−12h** `pre_pickup_reminder` | `Reminder: your Kashmir cab pickup is tomorrow 🚗` + driver/vehicle line + “Need help? Reply…” | None |
| 12 | **T+2h** `day1_checkin` | `How was your pickup this morning?` | `All Good` · `Report Issue` |
| 13 | **T+1.5d** `midtrip_wellness` (trips ≥ 3 days) | `Everything going smoothly on your trip so far?` | `Yes, all good` · `Need Help` |
| 14 | **Pickup + trip days + 1 day** `post_trip_review` | `How was your trip? Tap a rating below.` | `Excellent` · `Okay` · `Poor` |

**Filled T−12h example**

```
Reminder: your Kashmir cab pickup is tomorrow 🚗
Driver: Irfan Bhat, Vehicle: Toyota Innova (JK01AA1111)
Need help? Reply to this message and our support team will assist.
```

---

## Who replies with what

| Who | What they tap / type | Next job |
|---|---|---|
| Guest | Quote button / list row | Token payment link |
| Guest | Pay ₹99 | Token ack + vendor notify |
| Vendor | Tap **Assign driver** (form) or reply `9876500001` / `DRIVER: …` | Parse driver → balance link |
| Guest | Pay remaining | Driver contact + driver assign + ride group |
| Guest / driver | **Join ride group** | Group join webhook (no extra WA) |
| Guest | Check-in / rating buttons | Logged; help path can alert ops |

`ops_alert` is a **JSON webhook**, not WhatsApp.
