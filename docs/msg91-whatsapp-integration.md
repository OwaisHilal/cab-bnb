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
- [ ] Point MSG91 **Webhook (New)** at `POST https://<your-production-host>/api/whatsapp/webhook` with header `x-msg91-webhook-secret` = `MSG91_WEBHOOK_SECRET`

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
   - **On Failed Event** — ops visibility (logged via status update)
5. URL: `https://<your-production-host>/api/whatsapp/webhook`
6. Method: **POST**, content-type **JSON**
7. Parameters: keep at least `customerNumber`, `direction`, `uuid`, `text`, `contentType`, `button`, `interactive`, `messages`, `contacts`, `eventName`, `integratedNumber`, `ts`, `replyMsgId`, `templateName`
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
6. Return 200 quickly; job enqueue only

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

Other `kind` values: `text` (requires `text`), `read` / `delivered` / `sent` / `failed`, `raw` (pass a full MSG91 object as `payload`).

You can also POST the same JSON straight at `/api/whatsapp/webhook` with header `x-msg91-webhook-secret`.

### 6.4 Inbound mapping to existing actions

| MSG91 inbound | Existing `ParsedAction` |
|---------------|-------------------------|
| `button.payload` = `BOOK_FULL::…` | `book_full` |
| `button.payload` = `BOOK_TOKEN::…` | `book_token` |
| `button.payload` = `NEGOTIATE::…` | `negotiate` |
| `button.payload` = `CHECKIN_OK::…` | `checkin_ok` |
| `button.payload` = `CHECKIN_HELP::…` | `checkin_help` |
| `button.payload` = `RATE_N::…` | `rate` |
| `text` matching `DRIVER:…` | `driver_details` |
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
