---
name: msg91-whatsapp-build
description: >-
  Implements Kashmir BnB Cabs MSG91 WhatsApp migration one phase at a time
  (0–5), keeping handlers, button payloads, and the job queue frozen. Use when
  the user asks to implement, build, wire, or start the next MSG91 WhatsApp
  phase, replace Meta Graph sends, or migrate WhatsApp to MSG91.
disable-model-invocation: true
---

# MSG91 WhatsApp Build

## Requirement documents

| Doc | Path | Use for |
|-----|------|---------|
| Integration | `docs/msg91-whatsapp-integration.md` | APIs, webhook, env, send vs session |
| Templates | `docs/whatsapp-templates.md` | Exact copy, buttons, payloads — do not change |
| Plan §6–§7 | `ref/kashmirbnb_whatsapp_engineering_plan (2).md` | Product rules |

**Phase checklists:** [phases.md](phases.md)

## Before writing code

1. Read integration doc §2–§7 and the target phase in [phases.md](phases.md)
2. Run **msg91-whatsapp-audit** if the current phase is unknown
3. Fetch current MSG91 request bodies from
   https://docs.msg91.com/whatsapp (and Context7 if available) — do not
   invent `namespace` / `body_1` / webhook field names
4. State which phase you are starting and list deliverables
5. Implement **only that phase**

## Build order (strict)

Do not reorder or skip without user approval:

```
Phase 0  → onboarding + .env.example MSG91 keys (no send-path swap)
Phase 1  → MSG91 client (Next + Deno), same result contract
Phase 2  → OTP: SMS SendOTP default + MSG91 WhatsApp auth-template retry
Phase 3  → Edge outbound internals of whatsapp.ts only
Phase 4  → MSG91 webhook adapter → existing ParsedAction
Phase 5  → E2E evidence + remove unused Graph send env from docs/example
```

**Audit gate:** Do not start phase N+1 until **msg91-whatsapp-audit** is
re-run and the report has **no A** and **no unexpected G/P** on phase N
deliverables. Expected-later **G** rows (later phase owners) are allowed.

The audit must number findings **G1, G2…** (gaps), **A1, A2…** (anomalies),
**P1, P2…** (partials) — a six-line yes/no table is not a passing gate.

## Hard rules (regression-proof)

- One phase per invocation
- Do **not** edit handler business logic in
  `sendQuotes.ts`, `computeNegotiation.ts`, `notifyVendorBooking.ts`,
  `sendConfirmationCard.ts`, `dispatchLifecycleEvents.ts` — only the shared
  send primitive
- Do **not** change `parseInboundAction` payload grammar
  (`BOOK_FULL::`, `BOOK_TOKEN::`, `NEGOTIATE::`, `CHECKIN_*::`, `RATE_N::`,
  `DRIVER:`)
- Do **not** send WhatsApp inline in the webhook or OTP verify (job queue)
- **Do** keep customer OTP SMS on MSG91 SendOTP (`lib/sms/sendOtpSms.ts`,
  `MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`). Default `POST /api/otp/send`
  is SMS-first. WhatsApp OTP is an explicit `prefer=whatsapp` retry, not
  the default send. Phone.Email is the fallback when the **chosen** OTP
  channel fails. Do **not** revert `sendOtpSms.ts` to a stub. Do **not**
  wire SMS for quotes/lifecycle — Edge `sendSmsFallback` stays stub
- Deno cannot import Next `server-only` — duplicate client:
  `lib/msg91/` (Next) and `supabase/functions/_shared/msg91WhatsApp.ts` (Deno)
- Keep `sendWhatsApp*` / `sendWhatsAppOtp` return types identical
  (`configured`, `success`, `waMessageId?`, `error?`)
- Do not claim out-of-window messages production-ready on session APIs
  alone (vendor notify, pre-pickup, mid-trip, review need Green utility
  templates)

## Architecture

```
Handlers (frozen) → sendWhatsApp*() → MSG91 REST (authkey + integrated_number)
Inbound → /api/whatsapp/webhook → MSG91 adapter → parseInboundAction → job_queue
```

Edge secrets: `supabase secrets set` — Deno does not read `.env.local`.

## Per-phase completion

Before claiming the phase done:

1. Run that phase’s **Gate** in [phases.md](phases.md)
2. Run **msg91-whatsapp-audit** scoped to this phase — require **G** / **A** / **P** tables with numbered IDs
3. Use **verification-before-completion** — evidence before claims
4. If the audit lists any **A** or unexpected **G**/**P** on this phase’s rows, the
   phase is **not** closed — fix or disclose, do not start N+1

## When user says "implement next phase"

1. Audit or grep to find the last completed MSG91 phase
2. State the phase and deliverables
3. Implement only that phase — minimal diff
4. Report verify results with evidence

## Do not

- Call `graph.facebook.com` from new send code (Phase 1+)
- Change template wording in handlers
- Wire `type: "template"` for a utility message before the user confirms
  the MSG91 template name is approved
- Remove Meta Graph send env from `.env.example` before Phase 5
- Mark Phase 5 complete without the integration-doc §10 journey evidence

## Related skills

- **msg91-whatsapp-audit** — mandatory gate after every phase
- **whatsapp-template-submission** — dashboard drafts; never invent approval
- **whatsapp-feature-audit** — product completeness, not MSG91 transport
- **verification-before-completion** — required before claiming done
