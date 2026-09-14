# MSG91 WhatsApp Integration Guide — Kashmir BnB Cabs

Plan and reference for replacing **direct Meta Graph API** WhatsApp sends with **MSG91 as the sole WhatsApp provider**. This doc covers architecture, APIs, webhooks, templates, env vars, and implementation passes.

**Scope:** WhatsApp via MSG91 for quote/lifecycle (Phases 2–3). Customer OTP uses MSG91 **SMS SendOTP** first, Phone.Email second, WhatsApp template OTP only as an explicit retry. Not in scope: MSG91 SMS for quotes/lifecycle; email.

**Companion doc:** Template copy, variables, and button payloads for all 9 message types live in [`whatsapp-templates.md`](./whatsapp-templates.md).

**Status (codebase):** OTP send is SMS SendOTP first; WhatsApp template OTP is an explicit retry. Edge sends still Meta Graph.

- Live OTP SMS: `lib/sms/sendOtpSms.ts` → `POST /api/v5/otp` (`MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`)
- WhatsApp OTP retry: `lib/whatsapp/sendAuthTemplateOtp.ts` → MSG91 bulk template (`prefer=whatsapp`)
- Live Edge send: `supabase/functions/_shared/whatsapp.ts` → `graph.facebook.com` (Phase 3)
- Webhook: `app/api/whatsapp/webhook/route.ts` (MSG91 Webhook (New) + legacy Meta envelope)

---

## 1. Decision summary

| Question | Answer |
|----------|--------|
| Use MSG91 for WhatsApp? | Yes — primary BSP, replace Meta direct API calls |
| Use MSG91 for SMS? | **OTP only** — SendOTP in `lib/sms/sendOtpSms.ts`. Edge quote SMS stays stub; Phone.Email remains last OTP fallback |
| Still need Meta? | Indirectly — MSG91 connects your WABA; templates are approved by Meta behind MSG91 |
| Register templates where? | MSG91 dashboard (or MSG91 template APIs); see §4 |
| Reuse Meta webhook code? | No — MSG91 **Webhook (New)** uses a different JSON shape (§6) |

---

## 2. Architecture: current vs target

### Current (Meta direct)

```
Handlers → sendWhatsApp*() → graph.facebook.com/v20.0/{phone_number_id}/messages
                              Bearer WHATSAPP_ACCESS_TOKEN

Inbound → POST /api/whatsapp/webhook
          Meta GET challenge + X-Hub-Signature-256
          entry[].changes[].value.messages[] / statuses[]
```

### Target (MSG91 only)

```
Handlers → sendWhatsApp*() → MSG91 REST APIs (authkey header)
                              api.msg91.com / control.msg91.com

Inbound → POST /api/whatsapp/webhook (same URL, new adapter)
          MSG91 Webhook (New) JSON
          customerNumber, eventName, uuid (WAMID), button, text, …
          → map to existing ParsedAction → job_queue (unchanged)
```

**What stays unchanged:** Job queue, handlers (`sendQuotes`, `computeNegotiation`, lifecycle, etc.), `parseInboundAction` payload semantics (`BOOK_FULL::uuid`, `DRIVER:…`, `RATE_5::booking_id`).

**What must change:** HTTP client layer, env vars, webhook parsing/verification, template registration workflow.

---

## 3. MSG91 WhatsApp API surface

Official hub: [docs.msg91.com/whatsapp](https://docs.msg91.com/whatsapp)

| API (docs index) | Purpose | Maps to this app |
|------------------|---------|------------------|
| **Send WhatsApp Template** | Business-initiated / template conversation | OTP, proactive quotes, vendor notify, reminders, lifecycle |
| **Send message (once session started)** | Custom message inside 24h window | Optional free text if session open |
| **Interactive WA with Buttons** | Body + quick-reply buttons (`id`, `title`) | Quotes, negotiation, check-in, review |
| **Interactive WA with List** | List message | Not implemented in app (Plan §6.1 alternative) |
| **Get Templates** | List templates for integrated number | Sync names/namespaces to env |
| **Create / Edit / Delete Template** | Programmatic template CRUD | Optional; dashboard is primary |
| **To Fetch WhatsApp Number** | List integrated numbers | Onboarding |

### 3.1 Primary template send endpoint

From [WhatsApp OTP help](https://msg91.com/help/whatsapp/whatsapp-otp):

The Phase 1 client posts to the official bulk URL from [template-bulk](https://docs.msg91.com/whatsapp/template-bulk) / [CRQID help](https://msg91.com/help/whatsapp/how-to-pass-crqid-in-whatsapp-):

`POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/`

The OTP help article lists `https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/` as an alias. Headers: `authkey`, `content-type: application/json`.

**Body (conceptual):**

```json
{
  "integrated_number": "<your_integrated_number>",
  "content_type": "template",
  "payload": {
    "messaging_product": "whatsapp",
    "type": "template",
    "template": {
      "name": "<template_name>",
      "language": { "code": "en_US", "policy": "deterministic" },
      "namespace": "<template_namespace>",
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

**Differences from current Meta code:**

| Meta (today) | MSG91 |
|--------------|--------|
| `Authorization: Bearer` + `phone_number_id` in URL | `authkey` header + `integrated_number` in body |
| `components: [{ type: "body", parameters: [...] }]` | `body_1`, `button_1`, … keyed components |
| No `namespace` | `template.namespace` required |
| `to` on root payload | `to_and_components[].to[]` |

Optional: pass `CRQID` at root or per recipient for webhook correlation — [CRQID help](https://msg91.com/help/whatsapp/how-to-pass-crqid-in-whatsapp-).

### 3.2 OTP authentication template

From [WhatsApp OTP verification](https://msg91.com/help/whatsapp/whatsapp-otp):

- Category: **Authentication** in MSG91 dashboard
- Components: `body_1` (OTP value) + `button_1` (copy-code URL subtype with same OTP)
- **Meta restrictions:** Auth templates require eligible WABA tier / business verification — not all accounts get auth templates immediately
- **Testing:** Do not send auth templates from WABA → WABA; use a consumer WhatsApp number

### 3.3 Session vs template sends

| Scenario | MSG91 approach |
|----------|----------------|
| OTP (cold start) | **Template** (Authentication) |
| Quotes immediately after OTP verify | **Interactive Buttons API** (24h session) *or* **Utility template** |
| Negotiation (same session) | Interactive Buttons *or* template |
| Vendor notification (cold to vendor) | **Utility template** (vendor may have no open session) |
| Pre-pickup / post-trip (days later) | **Utility template** (outside 24h window) |
| Confirmation card image | Template with media header *or* session image API |

**Production recommendation:** Register **utility templates** for all proactive/lifecycle messages (see [`whatsapp-templates.md`](./whatsapp-templates.md)), not rely only on session APIs.

### 3.4 Interactive buttons (quotes, negotiation, lifecycle)

MSG91 documents **Interactive WA with Buttons** for messages with header, body, footer, and buttons with **titles and IDs**.

Your button IDs must remain:

```
BOOK_FULL::<quote_snapshot_id>
NEGOTIATE::<quote_snapshot_id>
BOOK_TOKEN::<quote_snapshot_id>
CHECKIN_OK::<lifecycle_event_id>
CHECKIN_HELP::<lifecycle_event_id>
RATE_1::<booking_id> … RATE_5::<booking_id>
```

Labels ≤ 20 characters (Meta/MSG91 limit). See button table in [`whatsapp-templates.md`](./whatsapp-templates.md).

### 3.5 Payment link (₹99 token lock)

Not a Meta Utility template. After the tourist taps `Select {vendor}` (`BOOK_TOKEN::`), we send MSG91 **WhatsApp Payments** inside the open 24h session.

Docs used:

- [Send Payment link via WhatsApp Payments](https://docs.msg91.com/whatsapp/-send-payment-link-via-whatsapp-payments) — Context7 `/websites/msg91`
- [Payment Link Feature Using Cashfree](https://msg91.com/help) (Cashfree client id/secret on the MSG91 panel; Cashfree is the only PG)
- [How to pass CRQID](https://msg91.com/help/whatsapp/how-to-pass-crqid-in-whatsapp-)
- [On Payment Report Received](https://msg91.com/help/webhook-new/how-to-receive-whatsapp-delivery-reports-via-webhook-new)

`POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/` (`api.msg91.com` is an alias; this app keeps `control.msg91.com`)

```json
{
  "recipient_number": "9198XXXXXXXX",
  "integrated_number": "91XXXXXXXXXX",
  "content_type": "interactive",
  "CRQID": "<whatsapp_payment_intents.id>",
  "interactive": {
    "type": "payment_link",
    "header": { "type": "image", "image": { "link": "https://…" } },
    "body": { "text": "Lock this cab with a ₹99 token. …" },
    "footer": { "text": "Pay ₹99 to lock this cab." },
    "items": [{ "name": "Token lock · Aala Cabs · 5 days", "amount": 99, "quantity": 1 }]
  }
}
```

Rules we follow:

- Body required; header/footer optional. Footer ≤ 60. Item **name** ≤ 60.
- Amount/quantity are **numbers**. Cart totals **₹99** (one line item). Trip days and vendor overview live in **body text**, not extra line items.
- Must be inside the 24h customer-care window (opened by `quote_choice_v1`).
- `CRQID` at payload root is returned on **On Payment Report Received**. Never treat `unpaid` as paid.

Flow:

1. `BOOK_TOKEN::{quote_snapshot_id}` → job `send_token_payment_link`
2. Guest pays via the shared static Cashfree Payment Link → `app/api/cashfree/webhook` verifies
   and **logs** the event for manual review only (no automated `finalize_booking`, see
   [`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md))
3. Demo mock chat cannot render Cashfree; it shows `TOKEN_PAY::{quote_snapshot_id}` instead

Catalog key: `token_lock_payment_v1` (`SESSION` / `session_cta_url` as of Sep 2026). MSG91's
`payment_link` interactive type (Cashfree Orders/S2S) is blocked on this merchant account
(`s2s_enabled_not_approved`), and a follow-up attempt to create per-booking links directly via
Cashfree's own Payment Links API was also blocked (`link_creation_api is not enabled or
approved`) — the ₹99 token now goes out as a plain `cta_url` button ("Pay 99") linking to one
dashboard-created static Cashfree link for every booking (`STATIC_TOKEN_PAYMENT_LINK_URL` in
`lib/whatsapp/tokenPaymentLink.ts`). See
[`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md). `MSG91_PAYMENT_LINK_HEADER_IMAGE_URL` no longer applies to this send (`cta_url` has no header).

**On Payment Report Received is still required for the remaining-balance Pay Now** (unchanged,
still MSG91 `payment_link`). The ₹99 token has **no automated payment confirmation** right now —
Cashfree's webhook for the shared static link is audit-only (see the doc above); confirming a
token payment and unlocking a specific booking is a manual step until a per-booking correlation
mechanism exists again. `COMPLETE_PAYMENT` / `BALANCE_PAY` / `TOKEN_PAY` buttons are demo-only.

### 3.6 After token: guest ack, vendor UTILITY, remaining payment_link

Token paid → `finalize_booking` → booking `token_paid` / `vendor_confirming`. Jobs then:

1. `send_token_received_ack` (`token_received_v1`, **UTILITY** / bulk template) — payment received, allocating a driver, ~30 minutes. Create this template **Green** on MSG91 (`MSG91_TOKEN_RECEIVED_TEMPLATE_NAME`). Body cannot start or end with a variable. Session text is the fallback if bulk fails.
2. `notify_vendor_booking` (`vendor_assign_driver_v1`, **UTILITY**) — selected vendor POC only. Env still `MSG91_VENDOR_NOTIFY_TEMPLATE_*` (default name `vendor_assign_driver_v1`). Do not mutate approved `vendor_booking_notify_v1`. Session text fallback if the template is not Green. Vendor replies with a whole-body 10-digit mobile, or optional `DRIVER: name | phone | vehicle | model`.
3. `send_balance_payment` — session `payment_link` (`driver_assigned_payment_v1`) for `tripTotal − ₹99`. Header image is a public HTTPS Storage URL from bucket `driver-cards` (compose via Node `POST /api/internal/driver-card`, `APP_URL` + `CRON_SECRET`). **Never** put Pay Now on a Utility template. If the image send fails, retry `payment_link` without image. `localhost` / `/public` paths will not fetch in production; do not use short-lived signed URLs.
4. Paid remaining report (`purpose = balance`, same **On Payment Report Received**, `CRQID` = balance intent id) → `complete_balance_payment` → `fully_paid` / `ready_for_pickup`.

Utility templates **cannot** include WhatsApp Payments Pay Now. Remaining amount is always session `payment_link`.

### 3.7 Ride WhatsApp groups (after `fully_paid` + `ready_for_pickup`)

WhatsApp cannot add the guest or driver into a group. MSG91 creates the group and returns an invite link; both people tap **Join**. Use `join_approval_mode: auto_approve`.

Trigger: `create_ride_group` after payment success **and** driver assigned (`complete_balance_payment` or confirmation card). Do not create the group on payment alone.

| Job | When |
|-----|------|
| `create_ride_group` | Booking is `fully_paid` + `ready_for_pickup` |
| `remind_ride_group_join` | +30 minutes if either party has not joined → reminder + `ops_alert` |
| `delete_ride_group` | Pickup + trip days + 24h — delete the group (no remove-then-delete) |

Invite messages: **UTILITY template first** (`ride_group_guest_v1` / `ride_group_driver_v1`) with CTA URL `https://chat.whatsapp.com/{{1}}`. Session `cta_url` then plain text (link in the body) are fallbacks. The guest copy states that joining helps quality-control communication.

Create the two templates Green on MSG91. Env: `MSG91_RIDE_GROUP_GUEST_*`, `MSG91_RIDE_GROUP_DRIVER_*`. Optional `MSG91_WHATSAPP_GROUPS_URL` (default `https://control.msg91.com/api/v5/whatsapp/groups`).

Group webhooks update `whatsapp_ride_groups.customer_joined_at` / `driver_joined_at`. Conversation text is **not** treated as the source of truth — we store metadata + events, then moderate from our DB.

[MSG91 create group](https://docs.msg91.com/whatsapp/create-group) · [send on group](https://docs.msg91.com/whatsapp/send-message-on-group) · [delete group](https://docs.msg91.com/whatsapp/delete-group)

---

## 4. Template management

### 4.1 Dashboard (primary path)

[How to create a WhatsApp Template](https://msg91.com/help/MSG91/how-to-create-a-template-for-whatsapp)

1. MSG91 Dashboard → **WhatsApp** → **Templates** → **Create Template**
2. Choose category: **Authentication** (OTP) or **Utility** (everything else)
3. Add body, optional header/footer/media, quick-reply buttons (max 3)
4. Submit → Meta review (status: Brown = review, Green = approved, Red = rejected)
5. Click **code** on approved template for per-template API cURL

**Rules:**

- Body max 1024 chars; footer max 60; button label max 20 chars
- Body **cannot start or end with a variable** (rejection risk)
- Variables: `{{1}}`, `{{2}}` or named variables
- Quick reply: max 3 buttons

Onboarding: [How to begin with WhatsApp](https://msg91.com/help/whatsapp/how-to-begin-with-whatsapp) · [Send WhatsApp](https://msg91.com/help/whatsapp/send-whatsapp)

### 4.2 Template API docs (programmatic CRUD)

| Action | Doc URL |
|--------|---------|
| Create | [Create Template](https://docs.msg91.com/whatsapp/create-whatsapp-template) |
| List | [Get Templates](https://docs.msg91.com/whatsapp/get-templates) |
| Edit | [Edit Template](https://docs.msg91.com/whatsapp/edit-template-1) |
| Delete | [Delete Template](https://docs.msg91.com/whatsapp/delete-template) |

Use **Get Templates** after approval to read `name`, `namespace`, language, status into env/config.

### 4.3 Template inventory

All 9 message types, exact copy, and suggested names: [`whatsapp-templates.md`](./whatsapp-templates.md) § Template inventory.

---

## 5. Environment variables (target)

Replace Meta send credentials with MSG91:

| Variable (proposed) | Purpose |
|---------------------|---------|
| `MSG91_AUTH_KEY` | API auth (maps to `authkey` header) |
| `MSG91_WHATSAPP_INTEGRATED_NUMBER` | Sender integrated number |
| `MSG91_OTP_TEMPLATE_NAME` | Auth template name |
| `MSG91_OTP_TEMPLATE_NAMESPACE` | Auth template namespace |
| `MSG91_OTP_TEMPLATE_LANGUAGE` | e.g. `en_US` |
| `MSG91_USE_APPROVED_TEMPLATES` | `true`/`yes`/`1` (default if unset): bulk Utility templates. `false`/`no`/`0`: session text / interactive. SMS OTP and Cashfree `payment_link` are never gated. |

**Template vs session toggle** (`MSG91_USE_APPROVED_TEMPLATES`): This is not `DEMO_MODE`. Demo fakes OTP (`123456`). This flag still calls real MSG91; it only chooses [template-bulk](https://docs.msg91.com/whatsapp/template-bulk) vs [session text](https://docs.msg91.com/whatsapp/send-message-in-text) / [buttons](https://docs.msg91.com/whatsapp/interactive-whatsapp-buttons) / [list](https://docs.msg91.com/whatsapp/interactive-whatsapp-list). Session APIs use `content_type: "text"` or `"interactive"` — there is no session `type: "utility"` (Utility is a Meta template category). Session sends only work inside an open 24h window; SMS OTP does not open WhatsApp. Message the business number first, or use WhatsApp Auth OTP (`prefer=whatsapp`). Vendor notify in session mode fails if that vendor has never messaged the number.

Per utility template (as you wire them):

```
MSG91_QUOTE_TEMPLATE_NAME
MSG91_QUOTE_TEMPLATE_NAMESPACE
MSG91_NEGOTIATION_OFFER_TEMPLATE_NAME
… (see approval tracker in whatsapp-templates.md)
```

**Deprecate after migration:**

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN` (Meta GET challenge)
- `WHATSAPP_APP_SECRET` (Meta HMAC)

**Keep (not MSG91-specific):**

- `CONFIRMATION_CARD_IMAGE_URL*` — confirmation card images
- `MIDTRIP_WELLNESS_MIN_DAYS`, `VENDOR_DRIVER_DETAIL_SLA_MINUTES`, etc.

**Edge Functions:** Set via `supabase secrets set` — Deno does not read `.env.local`.

---

## 5b. Phase 0 onboarding (user / dashboard)

Agent does not log into MSG91. You complete these before Phase 2/3 can send:

- [ ] MSG91 account + KYC
- [ ] Integrate WhatsApp Business number on MSG91
- [ ] Create templates from [`whatsapp-templates.md`](./whatsapp-templates.md) (Authentication OTP + Utility for the other 8)
- [ ] After Green approval, copy `name`, `namespace`, language into `MSG91_OTP_*` (and later utility env vars)
- [ ] Point MSG91 **Webhook (New)** at `POST https://<your-public-host>/api/whatsapp/webhook` with header `x-msg91-webhook-secret` = `MSG91_WEBHOOK_SECRET` (must be set in `.env` / `.env.local` / Vercel).
- [ ] Local `next dev` is not reachable from MSG91. Tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) or deploy, then put that HTTPS origin in Webhook (New) **On Inbound Request Received**. Or prove Pay without a live tap via the simulator in §6.3 (`BOOK_TOKEN::<quote_snapshot_id>`). Live webhook returns 200 then drains `send_token_payment_link` via `after()` + `processDueJobs`. Success logs: `[whatsapp webhook] inbound` (`book_token` or title fallback) then `[whatsapp webhook] jobs`. Chat text `Select Aala Cabs` with no payload is not a tap unless it uniquely matches a sent quote for that phone (§6.3a).

The live webhook now accepts MSG91 Webhook (New) JSON. Do not point Meta's Cloud API webhook here — Meta posts to MSG91, MSG91 posts to us.

---

## 6. Webhooks — MSG91 Webhook (New)

**WhatsApp does not POST to this app.** Meta delivers inbound + status events to MSG91 (the BSP). MSG91 then HTTP POSTs **its own** JSON to your callback. That JSON is **not** the Meta Cloud API envelope (`object` / `entry[].changes[].value.messages[]`).

Guides:

- [Webhook (New) overview](https://msg91.com/help/webhook-new) — 8s timeout, retries, auto-pause on 4xx
- [WhatsApp delivery reports via Webhook (New)](https://msg91.com/help/webhook-new/how-to-receive-whatsapp-delivery-reports-via-webhook-new)

Context7 (`/websites/msg91`) covers **outbound** interactive sends, not this webhook shape. The help articles above are the source of truth for inbound payloads.

**App callback:** `POST /api/whatsapp/webhook`  
(`https://<your-domain>/api/whatsapp/webhook`)

Parser: `lib/whatsapp/webhook/parseMsg91Webhook.ts`. Button payloads still go through `parseInboundAction.ts` (`BOOK_TOKEN::…`, `DRIVER:`, etc.).

### 6.0 Create the webhook in MSG91 (dashboard)

Create **two** WhatsApp webhooks (or one per event with the same URL). MSG91 does not use Meta's GET `hub.challenge`.

1. MSG91 Dashboard → **WhatsApp** → **Webhook (New)** → **Create Webhook**
2. Name them (e.g. `kmr-inbound`, `kmr-read`)
3. Service: **WhatsApp**
4. Events (minimum for quote-choice buttons + quote viewed):
   - **On Inbound Request Received** — tourist taps `Select {vendor}` / vendor `DRIVER:` text
   - **On Inbound Report Received** — optional duplicate of inbound; we dedupe by `uuid` (WAMID)
   - **On Read Event** — `quote_snapshots.sent` → `viewed`
   - **On Payment Report Received** — Cashfree balance (Pay Now) paid/failed (`paymentStatus`, `orders`, `crqid`). The ₹99 token no longer confirms through this; see [`cashfree-payment-links-workaround.md`](./cashfree-payment-links-workaround.md).
   - **On Failed Event** — ops visibility (logged via status update)
5. URL: `https://<your-production-host>/api/whatsapp/webhook`
6. Method: **POST**, content-type **JSON**
7. Parameters: keep at least `customerNumber`, `direction`, `uuid`, `text`, `contentType`, `button`, `interactive`, `messages`, `contacts`, `eventName`, `integratedNumber`, `ts`, `replyMsgId`, `templateName`, `crqid`, `paymentStatus`, `orders`, `webhookType`
8. Headers (required for our route):

   | Key | Value |
   |-----|--------|
   | `x-msg91-webhook-secret` | same string as `MSG91_WEBHOOK_SECRET` in `.env.local` / Vercel |

9. Create. Respond **200 within 8 seconds**. Do not return 4xx on processing bugs (MSG91 auto-pauses the webhook). Auth failures (401) will pause it — keep the secret in sync.

`button`, `messages`, `interactive`, `contacts`, and `content` arrive as **stringified JSON**. The parser JSON-parses those fields.

### 6.1 Payload shape (not Meta)

**Inbound example fields:**

| Field | Meaning |
|-------|---------|
| `customerNumber` | Sender phone (e.g. `917748847990`) |
| `direction` | `0` = inbound, `1` = outbound |
| `uuid` | Meta WAMID |
| `text` | Plain text body |
| `contentType` | `text`, `image`, `interactive`, … |
| `button` | Stringified JSON, e.g. `{"payload":"BOOK_FULL::uuid","text":"Book Now"}` |
| `messages` | Stringified JSON array (Meta-like message objects) |
| `eventName` | `delivered`, `read`, `failed`, … |
| `replyMsgId` | WAMID of message user replied to |

**Outbound status example:** `eventName: "read"`, `uuid` = WAMID, `templateName`, `customerNumber`.

### 6.2 Adapter (shipped)

`parseMsg91Webhook.ts` maps MSG91 JSON → `InboundWhatsAppMessage` / `InboundWhatsAppStatus`:

1. Parse inbound `text` / `messages[].text.body` → `DRIVER:` free text → `parseInboundAction`
2. Parse stringified `button` (`payload`) **and** session `interactive.button_reply.id` → `BOOK_TOKEN::…` etc.
3. Map `eventName: "read"` + `direction: "1"` + `uuid` → `quote_snapshots.viewed`
4. **Dedupe by `uuid` (WAMID)** — MSG91 may retry / Meta may duplicate
5. Auth via `x-msg91-webhook-secret` (not Meta `X-Hub-Signature-256`)
6. Return 200 quickly; job enqueue only. `after()` then runs `processDueJobs` so `send_token_payment_link` can send without waiting for cron.

### 6.3 Simulate without live WhatsApp

`POST /api/internal/msg91/simulate/webhook` (header `authkey` = `MSG91_SIM_AUTH_KEY` or `MSG91_AUTH_KEY`) builds a Webhook (New) body and **POSTs it to** `/api/whatsapp/webhook`.

```bash
curl -sS -X POST http://localhost:3000/api/internal/msg91/simulate/webhook \
  -H "authkey: $MSG91_SIM_AUTH_KEY" \
  -H "content-type: application/json" \
  -d '{
    "kind": "button",
    "customerNumber": "919876543210",
    "buttonPayload": "BOOK_TOKEN::<quote_snapshot_uuid>",
    "buttonText": "Select Aala Cabs"
  }'
```

Other `kind` values: `text` (requires `text`), `payment` (requires `crqid`, optional `paymentStatus`, default `paid`), `read` / `delivered` / `sent` / `failed`, `raw` (pass a full MSG91 object as `payload`).

The simulator also runs local `processDueJobs` after a successful webhook (so `send_token_payment_link` can send without cron / an undeployed Edge worker). Live `POST /api/whatsapp/webhook` now does the same drain in `after()` after the 200 response.

**Silent tap on localhost:** if `next dev` never logs `POST /api/whatsapp/webhook` after you tap a quote button, MSG91 did not reach this process. A public URL is required for real phone taps:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then set Webhook (New) to `https://<tunnel>/api/whatsapp/webhook` + `x-msg91-webhook-secret`.

Windows simulator (use the real `quote_snapshots.id`, not the button title):

```bash
curl -sS -X POST http://localhost:3000/api/internal/msg91/simulate/webhook ^
  -H "authkey: YOUR_MSG91_AUTH_KEY" ^
  -H "content-type: application/json" ^
  -d "{\"kind\":\"button\",\"customerNumber\":\"91XXXXXXXXXX\",\"buttonPayload\":\"BOOK_TOKEN::<quote_snapshot_uuid>\",\"buttonText\":\"Select Aala Cabs\"}"
```

### 6.3a Title-only `Select {vendor}` fallback

Utility template inbound sometimes has the button title and no `BOOK_TOKEN::` payload. After `parseInboundAction` returns `unknown`, if the text is `Select …` we uniquely match `vendors.business_name` on the latest trip with `sent`/`viewed` snapshots for that phone (same 20-character title truncation as send). Zero or two-plus matches stay `unknown` (no auto-reply). Other free text (e.g. `Need help?`) is still logged only.

Paid-token simulator (after Pay succeeds, or to skip the tap):

```bash
curl -sS -X POST http://localhost:3000/api/internal/msg91/simulate/webhook \
  -H "authkey: $MSG91_AUTH_KEY" \
  -H "content-type: application/json" \
  -d '{
    "kind": "payment",
    "customerNumber": "919876543210",
    "crqid": "<payment_intent_uuid_or_quote_snapshot_id>",
    "paymentStatus": "paid"
  }'
```

You can also POST the same JSON straight at `/api/whatsapp/webhook` with header `x-msg91-webhook-secret`.

### 6.4 Inbound mapping to existing actions

| MSG91 inbound | Existing `ParsedAction` |
|---------------|-------------------------|
| `button.payload` = `BOOK_FULL::…` | `book_full` |
| `button.payload` = `BOOK_TOKEN::…` | `book_token` → job `send_token_payment_link` |
| Title `Select {vendor}` with no payload, unique sent/viewed snapshot for that phone | `book_token` (fallback) |
| `button.payload` = `TOKEN_PAY::…` | `token_pay` (demo / mock chat only) → `finalize_booking` |
| MSG91 `paymentStatus` paid + `crqid` + intent `purpose=token_lock` | enqueue `finalize_booking` (`token_99`) |
| MSG91 `paymentStatus` paid + `crqid` + intent `purpose=balance` | enqueue `complete_balance_payment` |
| Missing `crqid` / unknown purpose | log, do not guess |
| `button.payload` = `BALANCE_PAY::…` / `COMPLETE_PAYMENT::…` | `complete_payment` (demo / mock chat only) |
| `text` matching `DRIVER:…` or a whole-body phone | `driver_details` |
| `button.payload` = `NEGOTIATE::…` | `negotiate` |
| `button.payload` = `CHECKIN_OK::…` | `checkin_ok` |
| `button.payload` = `CHECKIN_HELP::…` | `checkin_help` |
| `button.payload` = `RATE_N::…` | `rate` |
| Other text | `unknown` (no auto-reply today) |

`enqueueWebhookAction.ts` and job handlers stay the same after adapter produces `InboundWhatsAppMessage` / `ParsedAction`.

---

## 7. Code touchpoints

| Area | File | Change |
|------|------|--------|
| OTP SMS send | `lib/sms/sendOtpSms.ts` | MSG91 SendOTP (`/api/v5/otp`) |
| OTP WhatsApp retry | `lib/whatsapp/sendAuthTemplateOtp.ts` | MSG91 template API + `body_1`/`button_1` (`prefer=whatsapp`) |
| OTP send route | `app/api/otp/send/route.ts` | SMS first; Phone.Email on failure; WhatsApp only if `prefer=whatsapp` |
| Edge sends | `supabase/functions/_shared/whatsapp.ts` | MSG91 template / interactive / session APIs |
| Webhook route | `app/api/whatsapp/webhook/route.ts` | MSG91 adapter + optional Meta HMAC fallback |
| Webhook parse | `lib/whatsapp/webhook/parseMsg91Webhook.ts` | Webhook (New) flat JSON |
| Signature | `lib/whatsapp/webhook/verifyMsg91Webhook.ts` | `x-msg91-webhook-secret` |
| Env | `.env.example` | MSG91 vars; deprecate Meta send vars |
| Docs | `docs/whatsapp-templates.md` | Update “provider” column when done |

**Deno constraint:** Edge Functions cannot import `lib/whatsapp/*` (`server-only`). Implement MSG91 client in:

- `supabase/functions/_shared/msg91WhatsApp.ts` (Deno)
- `lib/msg91/whatsapp.ts` or similar (Next) — mirror or share fetch logic

**Handlers unchanged:** `sendQuotes.ts`, `computeNegotiation.ts`, `notifyVendorBooking.ts`, `sendConfirmationCard.ts`, `dispatchLifecycleEvents.ts`.

---

## 8. Implementation passes

### Pass 0 — Onboarding (blocking, mostly non-code)

- [x] `.env.example` MSG91 keys (empty) — agent Phase 0
- [ ] MSG91 account + KYC
- [ ] Integrate WhatsApp number on MSG91 ([onboarding video](https://www.youtube.com/watch?v=SXbcJ3ClruA))
- [ ] Meta Business verification if required for auth templates
- [ ] Create all templates in dashboard (copy from [`whatsapp-templates.md`](./whatsapp-templates.md))
- [ ] Wait for Green approval status
- [x] Configure Webhook (New) → production `/api/whatsapp/webhook` (code ready; you create the dashboard webhook)
- [ ] Record template `name`, `namespace`, language from Get Templates / dashboard cURL

### Pass 1 — MSG91 client + config

- [x] Shared send helper returning `{ configured, success, waMessageId?, error? }` — `lib/msg91/` + Deno twin (not wired to OTP/Edge yet)
- [x] Map MSG91 response `uuid` / `requestId` / `request_id` → `waMessageId`
- [ ] `MSG91_AUTH_KEY`, `MSG91_WHATSAPP_INTEGRATED_NUMBER` filled in env + Supabase secrets (user)

### Pass 2 — OTP via MSG91

- [x] Replace `sendAuthTemplateOtp.ts` with MSG91 bulk template send
- [x] `body_1` + `button_1` for authentication template
- [ ] Test: default `POST /api/otp/send` → `channel: "sms"`; `prefer=whatsapp` → `channel: "whatsapp"` (needs filled `MSG91_*` + Green auth template + consumer number)

### Pass 3 — Edge outbound (bulk of messages)

- [ ] Replace `whatsapp.ts`: button messages (quotes, negotiation, lifecycle)
- [ ] Text messages (vendor notify, pre-pickup reminder)
- [ ] Image + caption (confirmation card)
- [ ] Use template API for proactive; interactive API where session allows

### Pass 4 — Webhook adapter

- [ ] Parse MSG91 inbound (text, button, read events)
- [ ] Dedupe by WAMID
- [ ] Feed existing `parseInboundAction` + `enqueueWebhookAction`
- [ ] Read → `quote_snapshots.viewed`

### Pass 5 — End-to-end + cleanup

- [ ] Full journey: OTP → quotes → negotiate → book → vendor `DRIVER:` → confirmation → lifecycle buttons
- [ ] Remove unused Meta env vars from docs/example
- [ ] Update approval tracker in `whatsapp-templates.md`

**Estimated dev passes:** ~6 (Pass 0 parallel with Pass 1–2).

**Optional Pass 6+:** Convert every proactive message to dedicated utility **templates** (recommended for production outside 24h window).

---

## 9. MSG91 vs Meta direct — quick reference

| Topic | Meta direct (current) | MSG91 (target) |
|-------|----------------------|----------------|
| Send URL | `graph.facebook.com/v20.0/{id}/messages` | `api.msg91.com/api/v5/whatsapp/...` |
| Auth | Bearer token | `authkey` header |
| Template params | `components[].parameters` | `body_1`, `button_1`, … |
| Namespace | Not used in code | Required in payload |
| Webhook | Meta `entry/changes` + HMAC | MSG91 flat JSON + Webhook (New) |
| Template admin | Meta Business Manager | MSG91 dashboard + optional API |
| SMS | Not via Meta | **Not planned** (Phone.Email fallback) |

---

## 10. Testing checklist

| Test | Expected |
|------|----------|
| OTP to consumer number | 6-digit code on WhatsApp |
| OTP verify → quotes job | Consolidated quote with 3 buttons |
| Tap Negotiate | Counter-offer message |
| Tap Book / Pay ₹99 | Booking + vendor notification |
| Vendor `DRIVER:…` reply | Confirmation card to customer |
| Lifecycle buttons | CHECKIN_OK / HELP / RATE recorded |
| Read receipt on quote | `quote_snapshots.status` → `viewed` |
| WhatsApp down | Phone.Email fallback (not SMS) |
| Duplicate webhook | Ignored (WAMID dedupe) |

---

## 11. External references

| Resource | URL |
|----------|-----|
| MSG91 WhatsApp docs hub | https://docs.msg91.com/whatsapp |
| Create template (API doc) | https://docs.msg91.com/whatsapp/create-whatsapp-template |
| Get templates | https://docs.msg91.com/whatsapp/get-templates |
| Edit template | https://docs.msg91.com/whatsapp/edit-template-1 |
| Delete template | https://docs.msg91.com/whatsapp/delete-template |
| Send template (bulk doc page) | https://docs.msg91.com/whatsapp/template-bulk |
| Session text send | https://docs.msg91.com/whatsapp/send-message-in-text |
| Create template (help) | https://msg91.com/help/MSG91/how-to-create-a-template-for-whatsapp |
| WhatsApp OTP API | https://msg91.com/help/whatsapp/whatsapp-otp |
| Webhook (New) | https://msg91.com/help/webhook-new/how-to-receive-whatsapp-delivery-reports-via-webhook-new |
| Send WhatsApp (help) | https://msg91.com/help/whatsapp/send-whatsapp |
| Begin with WhatsApp | https://msg91.com/help/whatsapp/how-to-begin-with-whatsapp |
| Optional Node SDK reference | https://www.npmjs.com/package/@qubitcodes/msg91 |

---

## 12. Related internal docs

- [`whatsapp-templates.md`](./whatsapp-templates.md) — All 9 message bodies, variables, buttons, job triggers, approval tracker
- `ref/kashmirbnb_whatsapp_engineering_plan (2).md` — Original product spec (§6 messages, §7 webhook)
- `.env.example` — Current Meta env vars (to be superseded by MSG91 vars)

---

*Last updated: August 2026 — OTP send is SMS SendOTP first, then Phone.Email, then WhatsApp retry. Edge sends still Meta Graph.*
