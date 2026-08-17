# MSG91 WhatsApp Build Phases

Reference: `docs/msg91-whatsapp-integration.md` §8
Copy/payloads: `docs/whatsapp-templates.md`

Audit is a **gate after every phase**, not a seventh phase.

---

## Phase 0 — Onboarding + env scaffold

**No send-path code change.**

| Deliverable | Notes |
|-------------|--------|
| MSG91 account + integrated WhatsApp number | User/dashboard; agent does not log in |
| Template drafts from `docs/whatsapp-templates.md` | User submits in MSG91 dashboard (Authentication + Utility) |
| Record names/namespaces/language | Only what the user reports — never invent Green |
| `.env.example` keys (empty values) | `MSG91_AUTH_KEY`, `MSG91_WHATSAPP_INTEGRATED_NUMBER`, `MSG91_OTP_TEMPLATE_NAME`, `MSG91_OTP_TEMPLATE_NAMESPACE`, `MSG91_OTP_TEMPLATE_LANGUAGE` |
| Keep existing `WHATSAPP_*` keys | Do not delete Graph send env until Phase 5 |
| Webhook URL documented | `POST /api/whatsapp/webhook` for MSG91 Webhook (New) — adapter lands in Phase 4 |

**Gate:** `.env.example` lists MSG91 keys; send files still Meta Graph; handler freeze intact.

**Audit after Phase 0 must list (not hide) numbered G/A/P:**

- **P:** `MSG91_*` keys present, values blank; template tracker `—`; dual Graph+MSG91 env keys (until Phase 5)
- **G** (not blockers): Client, webhook adapter, live journey (owners 1–5)
- **G** (user, still open): dashboard account, Green templates, filled secrets
- **A:** none expected; any freeze break is a blocker

**Audit dimensions closable to ✅:** handler freeze only. Credentials stay **P** until non-empty values (Phase 1). Templates stay **P**/**G** until user reports Green.

---

## Phase 1 — MSG91 client

| Deliverable | Path |
|-------------|------|
| Next client | `lib/msg91/` (e.g. send helper + types) |
| Deno client | `supabase/functions/_shared/msg91WhatsApp.ts` |
| Result contract | `{ configured, success, waMessageId?, error? }` |
| Phone format | Strip leading `+` from E.164 |
| Message id map | MSG91 `uuid` / `requestId` → `waMessageId` |
| Configured check | Missing `MSG91_AUTH_KEY` or integrated number → `{ configured: false }` |

Do **not** yet switch `sendAuthTemplateOtp.ts` or `whatsapp.ts` call sites if that would mix Meta+MSG91 in one file without a complete swap — prefer helpers ready for Phase 2/3 to import.

Fetch live payload shape from https://docs.msg91.com/whatsapp before writing JSON.

**Gate:** Unit-test or equivalent evidence: E.164 strip; `waMessageId` mapping; missing env → `configured: false`. Handlers untouched. No `graph.facebook.com` inside the new client files.

**Audit dimensions closable:** Client **partial** (helpers exist; live send path may still be Meta until 2–3). Handler freeze ✅.

---

## Phase 2 — OTP send

| Deliverable | Path |
|-------------|------|
| Replace Meta template send | `lib/whatsapp/sendAuthTemplateOtp.ts` → MSG91 bulk template API |
| Auth components | `body_1` + `button_1` (copy-code) per MSG91 OTP docs |
| Env | `MSG91_OTP_TEMPLATE_NAME` / `NAMESPACE` / `LANGUAGE` (fallback documented) |
| OTP route unchanged | `app/api/otp/send/route.ts` still WhatsApp then SMS stub then Phone.Email |

**Gate:** `sendWhatsAppOtp` no longer calls `graph.facebook.com`. Route still returns `{ sent, channel }` or `{ sent: false, fallback: "phone_email" }`. SMS stub unchanged.

**Audit dimensions closable:** Client (OTP send path). Credentials if env filled. Handler freeze ✅.

---

## Phase 3 — Edge outbound

**Edit only** `supabase/functions/_shared/whatsapp.ts` (and the Deno MSG91 helper). Do not edit the 8 handler files.

| Function | MSG91 mapping |
|----------|----------------|
| `sendWhatsAppButtonMessage` | Interactive-with-buttons **or** approved utility template with same button ids |
| `sendWhatsAppTextMessage` | Session text **or** utility template (vendor notify / pre-pickup are often out of 24h window) |
| `sendWhatsAppImageMessage` | Session image+caption **or** media-header template |
| `sendSmsFallback` | Leave stub |

Set Edge secrets: `MSG91_AUTH_KEY`, `MSG91_WHATSAPP_INTEGRATED_NUMBER`, plus any template name/namespace vars this phase needs.

**Gate:** Grep handlers — button titles/ids and body strings still match `docs/whatsapp-templates.md`. Grep `whatsapp.ts` — no `graph.facebook.com`. Do not claim vendor/lifecycle production-ready unless those templates are user-reported Green.

**Audit dimensions closable:** Client (Edge send path). Handler freeze ✅. Templates still user-reported.

---

## Phase 4 — Webhook adapter

| Deliverable | Path |
|-------------|------|
| MSG91 inbound parse | e.g. `lib/whatsapp/webhook/parseMsg91Webhook.ts` |
| Map to existing types | `InboundWhatsAppMessage` then `parseInboundAction` |
| Button field | Stringified JSON `button.payload` → `BOOK_FULL::…` etc. |
| Text | `text` / `messages` → `DRIVER:` path |
| Read receipts | `eventName: "read"` + `uuid` → `quote_snapshots.viewed` (same rules as today) |
| Dedupe | Unique `uuid` (WAMID); ignore duplicate events |
| Route | `app/api/whatsapp/webhook/route.ts` — fast 200, enqueue only |
| Verification | MSG91 webhook auth as documented — Meta `X-Hub-Signature-256` is not the live path |

Do **not** change `parseInboundAction.ts` grammar. Do **not** process WhatsApp sends inside the webhook.

**Gate:** Fixture MSG91 inbound JSON (button + `DRIVER:` text + read) produces the same `ParsedAction` types as today’s Meta parser would for the equivalent payload. Duplicate `uuid` does not double-enqueue.

**Audit dimensions closable:** Webhook. Handler freeze ✅.

---

## Phase 5 — E2E + Meta-send cleanup

| Deliverable | Notes |
|-------------|--------|
| Live journey | Integration doc §10 on a consumer WhatsApp number |
| Phone.Email | Still offered when WhatsApp send fails |
| Docs | Update `docs/whatsapp-templates.md` provider column; `docs/msg91-whatsapp-integration.md` status |
| Env cleanup | Remove unused Graph **send** vars from `.env.example` **only after** no remaining `graph.facebook.com` send caller |
| Secrets | Confirm Edge secrets set; do not commit `.env.local` |

**Gate:** Evidence for: OTP received; quotes + 3 buttons; negotiate; book/token; vendor `DRIVER:`; confirmation card; lifecycle button recorded; quote `read` → `viewed`; duplicate webhook ignored; Phone.Email fallback still reachable.

**Audit dimensions closable:** Live evidence. All six if templates were user-reported Green for out-of-window types; otherwise state that production gap explicitly.

---

## Out of scope (all phases)

- MSG91 SMS / implementing `SmsProvider`
- Changing handler copy or button payloads
- Skipping the audit gate
- Claiming Phase 5 without §10 evidence
