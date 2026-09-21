# `vendor_assign_driver_v2` — add an "Assign driver" button

**Status:** ☑ Created via MSG91's API on 2026-09-21 (`template_id 1399713785695491`) → ☐ waiting on Meta/WhatsApp review (Green) → tell the assistant once it's Green to wire up code.

---

## Update 2026-09-21 — created via API, not the dashboard

The manual dashboard steps below (Step 1) turned out to be unnecessary. Instead, `vendor_assign_driver_v2` was
created end-to-end through MSG91's real create-template API, with no manual dashboard entry:

- **DB catalog first:** `supabase/migrations/20260921000300_0025_vendor_assign_driver_v2.sql` updated the existing
  `vendor_assign_driver_v1` row (`template_key` unchanged) to `msg91_template_name = 'vendor_assign_driver_v2'` and
  `buttons = '[{"type":"url","label":"Assign driver"}]'::jsonb` — same v1→v2 rename pattern already used for
  `quote_choice_v2`/`quote_single_v2`. Applied to the linked project with `supabase db push`.
- **Reviewable builder + test:** `lib/whatsapp/vendorAssignDriverCreateTemplate.ts` →
  `buildVendorAssignDriverV2CreateApiBody()` builds the exact Facebook/WABA-shaped request body (unchanged v1 body
  copy + one new `BUTTONS` component). Covered by `lib/whatsapp/vendorAssignDriverCreateTemplate.test.ts`.
- **Dry-run then live script:** `scripts/msg91-create-vendor-assign-driver-v2.ts` (`npm run
  msg91:create-vendor-assign-v2`, then `-- --live`) printed the JSON for review first, then POSTed it to
  `https://api.msg91.com/api/v5/whatsapp/client-panel-template/`.
- **MSG91's response** (HTTP 200):
  ```json
  {
    "status": "success",
    "hasError": false,
    "data": {
      "message": "template creation in process. Please wait till the template is being approved from vendor",
      "template_id": "1399713785695491",
      "backup_templates": []
    },
    "errors": null
  }
  ```
  This confirms the precedent-based MSG91 envelope (`integrated_number`/`template_name`/`name`/`language`/
  `category`/`allow_category_change`/`components`) — inferred from `quoteChoiceTemplate.ts` since MSG91's own docs
  don't publish this shape — was in fact correct.

**Next:** watch the MSG91 dashboard (or `npm run msg91:templates`) for `vendor_assign_driver_v2` to turn Green,
then come back and do the Step 2 code wiring below.

## Why this template exists

Today, vendors get the `vendor_assign_driver_v1` Utility template as the cold-start "new booking" message. That
template has **zero buttons** — it's plain text, and the vendor must reply manually (10-digit phone, or
`DRIVER: name | phone | number | model`).

Interactive "Assign driver" buttons already work — but **only** on the session-message fallback path (when
`MSG91_USE_APPROVED_TEMPLATES=0`, or when the bulk template send fails). That's because WhatsApp/Meta templates
cannot have components (like buttons) added after approval — the button has to be baked into the template itself
and re-reviewed by Meta.

`vendor_assign_driver_v2` is that re-submission: **identical body copy** to v1 (to minimize review friction), plus
one **URL button** that opens the "Assign driver" web form directly from the cold-start message too.

---

## Step 1 — Create the template on MSG91

Go to: **MSG91 → WhatsApp → Templates → Create Template**

| Field | Value |
|---|---|
| Template name | `vendor_assign_driver_v2` |
| Category | `UTILITY` |
| Language | `en_US` |

### Body — paste exactly as-is

```
New booking confirmed.

Guest: {{1}}
Route: {{2}} → {{3}}
Date: {{4}}, {{5}} {{6}}
Pax: {{7}} | Cab: {{8}}
Total: {{9}}

Reply with the driver's 10-digit mobile to assign.
Optional: DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>
```

### Sample values for the 9 body variables (required by Meta for review)

| Var | Sample |
|---|---|
| `{{1}}` | Rahul Sharma |
| `{{2}}` | Srinagar |
| `{{3}}` | Pahalgam |
| `{{4}}` | 14 Aug |
| `{{5}}` | 3 |
| `{{6}}` | days |
| `{{7}}` | 4 |
| `{{8}}` | Sedan |
| `{{9}}` | ₹52,500 |

### Button — add one

| Field | Value |
|---|---|
| Button type | **Call to Action → Visit Website** |
| Button text | `Assign driver` |
| URL type | **Dynamic** |
| URL | `https://cab-bnb.vercel.app/vendor/assign-driver?token={{1}}` |
| Sample value for the button's `{{1}}` | `eyJib29raW5nSWQiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJ2ZW5kb3JJZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiIsImV4cCI6MTc1ODUyMzIwMDAwMH0.k8F3n2QpZ7xT1vM9wL4rY6bC0dE5fG2h` (fabricated example — just has to look like a realistic token to the reviewer) |

> WhatsApp allows a URL button's dynamic suffix up to 2000 characters. Our real signed tokens are well under that
> (~130–160 characters), so this is safe.

### Submit and wait for review

UTILITY category with a single URL button is usually reviewed faster than Marketing templates — typically minutes
to a few hours, not days. Watch the template's status in the dashboard until it shows **Green**.

---

## Step 2 — Once it's Green, tell the assistant

Report back "vendor_assign_driver_v2 is Green" (or share a screenshot). At that point these code changes will be
made together in one small diff:

1. `lib/whatsapp/notifyVendorBooking.ts` — add a `button_1: { type: "text", subtype: "url", value: <token> }`
   component to `msg91Components`, using the same `subtype: "url"` pattern already proven in
   `lib/msg91/pure.ts` (`buildMsg91AuthOtpComponents`, used for the OTP "Copy code" button).
2. `lib/whatsapp/templateEnv.ts` — update the `vendor_assign_driver_v1` entry's `defaultName` from
   `vendor_assign_driver_v1` to `vendor_assign_driver_v2` (same pattern used previously for
   `vendor_booking_notify_v1` → `vendor_booking_notify_v2`).
3. A new Supabase migration updating the `whatsapp_message_templates` catalog row (`msg91_template_name`,
   `buttons`, `notes`) — documentation table only, does not change behavior by itself.
4. Update `MSG91_VENDOR_NOTIFY_TEMPLATE_NAME=vendor_assign_driver_v2` in `.env.local` and in Vercel's
   environment variables (all environments you test in).
5. Update `docs/whatsapp-message-flow.md` and `docs/msg91-whatsapp-integration.md` to describe the button now
   living on the cold-start message too, not just the session fallback.

**Why not do this now:** `vendor_assign_driver_v1` (the one currently live and Green) has zero button components.
If the button-parameter code ships before v2 is approved, MSG91/Meta will reject the send because the payload
would include a component the approved template doesn't have — breaking the currently-working cold-start message.
Sequencing it after Green approval avoids that regression entirely.

---

## Reference: how buttons already work in this codebase

- Session fallback "Assign driver" CTA (works today, no approval needed): `lib/whatsapp/notifyVendorBooking.ts`
  → `ctaUrl`, sent via `lib/whatsapp/sendOutbound.ts` → `sendWhatsAppCtaUrlMessage`.
- Bulk-template URL button precedent already proven in production: `otp_verification`'s "Copy code" button —
  `lib/msg91/pure.ts` → `buildMsg91AuthOtpComponents` → `button_1: { subtype: "url", type: "text", value: code }`.
- Bulk-template quick-reply button precedent: `quote_choice_v1`/`v2` — `lib/whatsapp/quoteChoiceTemplate.ts` →
  `buildQuoteChoiceMsg91Components` → `button_N: { type: "text", subtype: "quick_reply", value: ... }`.
- Signed token generation: `lib/whatsapp/vendorAssignToken.ts` → `signVendorAssignToken` /
  `buildVendorAssignUrl`. Same logic mirrored for Supabase Edge Functions in
  `supabase/functions/_shared/vendorAssignToken.ts`.
