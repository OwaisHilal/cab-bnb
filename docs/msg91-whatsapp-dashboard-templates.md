# MSG91 WhatsApp dashboard templates

Create at **MSG91 → WhatsApp → Templates → Create Template**. Language **`en_US`**. Submit and wait for **Green**. Then copy **name + namespace** from the template’s **code** view.

Do not start or end a body with a variable. Button labels max 20 characters. Payloads like `BOOK_FULL::<id>` are not typed into the dashboard — titles only.

---

## 1. `otp_verification` — Authentication

Do **not** make this Utility. Use **Authentication / OTP + Copy code**.

Name must be `otp_verification` unless `MSG91_OTP_TEMPLATE_NAME` is changed later.

If the dashboard asks for sample body:

```
Your Kashmir BnB Cabs verification code is {{1}}. Do not share this code with anyone.
```

Button: **Copy code**. After Green, set `MSG91_OTP_TEMPLATE_NAMESPACE` and `MSG91_OTP_TEMPLATE_LANGUAGE=en_US`.

---

## 2. `quote_consolidated_v1` — Utility

Body:

```
Your Kashmir Cab Quotes Are In 🚖

{{1}}

Prices shown are opening quotes. You can negotiate.
```

`{{1}}` = all vendor lines, e.g. `⭐ Best Price — Vendor A: ₹2500/day (Sedan)` then more lines.

Buttons: `Book Best Price` · `Negotiate` · `Pay ₹99 to Lock`

---

## 3. `negotiation_offer_v1` — Utility

Body:

```
Here's our next offer: ₹{{1}}/day.
```

Buttons: `Book This Price` · `Negotiate Again` · `Pay ₹99 to Lock`

---

## 4. `negotiation_final_v1` — Utility

Body:

```
This is our best possible price: ₹{{1}}/day. Final offer.
```

Buttons: `Book Now` · `Pay ₹99 to Lock`

---

## 5. `vendor_booking_notify_v1` — Utility (no buttons)

Body:

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

---

## 6. `customer_confirmation_v1` — Utility

Optional **IMAGE** header. Body:

```
Your Cab Is Confirmed ✅
Driver: {{1}}
Vehicle: {{2}} ({{3}})
Pickup: {{4}} — {{5}}
Vendor: {{6}}
```

| Var | Sample |
|-----|--------|
| {{1}} | Bilal Ahmed |
| {{2}} | Swift Dzire |
| {{3}} | JK01AB1234 |
| {{4}} | 14 Aug, 09:00 |
| {{5}} | Srinagar |
| {{6}} | Vendor A |

---

## 7. `pre_pickup_reminder_v1` — Utility (no buttons)

Body:

```
Reminder: your Kashmir cab pickup is tomorrow 🚗
{{1}}
Need help? Reply to this message and our support team will assist.
```

`{{1}}` is either `Driver: Bilal Ahmed, Vehicle: Swift Dzire (JK01AB1234)` or `Driver details are being finalized.`

---

## 8. `day1_checkin_v1` — Utility

Body:

```
How was your pickup this morning?
```

Buttons: `All Good` · `Report Issue`

---

## 9. `midtrip_wellness_v1` — Utility

Body:

```
Everything going smoothly on your trip so far?
```

Buttons: `Yes, all good` · `Need Help`

---

## 10. `post_trip_review_v1` — Utility

Body:

```
How was your trip? Tap a rating below.
```

Buttons: `Excellent` · `Okay` · `Poor`
