---
name: msg91-whatsapp-audit
description: >-
  Audits Kashmir BnB Cabs MSG91 WhatsApp migration readiness across client,
  credentials, templates, webhook adapter, handler freeze, and live evidence.
  Use when the user asks to audit, check progress, check readiness, or ask
  whether MSG91 WhatsApp is done, live, or ready after a msg91-whatsapp-build
  phase.
disable-model-invocation: true
---

# MSG91 WhatsApp Audit

## Context

Replace **direct Meta Graph API** WhatsApp sends with **MSG91 as the sole
WhatsApp provider**. Meta still exists behind MSG91 (WABA + template
approval). The app must not call `graph.facebook.com` for sends.

**Sources of truth (read every run):**

| Doc | Path | Use for |
|-----|------|---------|
| Integration | `docs/msg91-whatsapp-integration.md` | Transport, APIs, webhook shape, env, phases |
| Templates | `docs/whatsapp-templates.md` | 9 message bodies, buttons, payloads, job map |
| Plan §6–§7 | `ref/kashmirbnb_whatsapp_engineering_plan (2).md` | Product copy and inbound action grammar |

This skill scores **transport migration**. For Plan §6–§7 product completeness
(handlers exist, job queue, OTP hash), use **whatsapp-feature-audit**.

## What's already done — product layer (do not re-litigate)

| Area | File | Status |
|------|------|--------|
| OTP route + Phone.Email fallback | `app/api/otp/send/route.ts` | Done — still calls `sendWhatsAppOtp` |
| Button/text/image primitives | `supabase/functions/_shared/whatsapp.ts` | Done — still Meta Graph |
| 8 Edge handlers | `supabase/functions/_shared/handlers/*.ts` | Done — freeze bodies/buttons |
| Inbound action grammar | `lib/whatsapp/webhook/parseInboundAction.ts` | Done — `BOOK_*` / `DRIVER:` / `RATE_*` |
| Job queue | `supabase/functions/job-queue-worker/index.ts` | Done — do not change job types |
| SMS OTP | `lib/sms/sendOtpSms.ts` | Stub — **leave stub**; MSG91 SMS is out of scope |

## What's NOT done — MSG91 transport (baseline until a phase closes it)

1. **No MSG91 client.** Sends still hit `graph.facebook.com` from
   `lib/whatsapp/sendAuthTemplateOtp.ts` and
   `supabase/functions/_shared/whatsapp.ts`.
2. **No MSG91 env.** `.env.example` has Meta `WHATSAPP_*` send vars, not
   `MSG91_AUTH_KEY` / `MSG91_WHATSAPP_INTEGRATED_NUMBER`.
3. **Templates not submitted via MSG91.** Approval tracker in
   `docs/whatsapp-templates.md` is blank unless the user reported Green.
4. **Webhook is Meta-shaped.** `parseWebhookPayload.ts` +
   `verifyWebhookSignature.ts` (`X-Hub-Signature-256`). MSG91 Webhook (New)
   is a flat JSON payload (`customerNumber`, `uuid`, stringified `button`).
5. **No live MSG91 journey evidence.**

## Audit workflow

```
Audit progress:
- [ ] Grep send path: graph.facebook.com, WHATSAPP_ACCESS_TOKEN, MSG91_
- [ ] Read sendAuthTemplateOtp.ts and supabase/functions/_shared/whatsapp.ts
- [ ] Read webhook route + parsers (Meta vs MSG91 adapter)
- [ ] Check .env.example (and .env.local if present) for MSG91_* vs leftover Graph vars
- [ ] Grep the 8 frozen handlers for body/button strings vs whatsapp-templates.md
- [ ] Check docs/whatsapp-templates.md approval tracker — only user-reported status
- [ ] Score the six dimensions below; write the report
```

Never mark a dimension done without reading the actual file or env. A helper
existing does not mean MSG91 is live.

### Handler freeze grep (dimension 5)

These files must still match `docs/whatsapp-templates.md` copy and payloads:

- `supabase/functions/_shared/handlers/sendQuotes.ts`
- `supabase/functions/_shared/handlers/computeNegotiation.ts`
- `supabase/functions/_shared/handlers/notifyVendorBooking.ts`
- `supabase/functions/_shared/handlers/sendConfirmationCard.ts`
- `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts`

Frozen strings include: `BOOK_FULL::`, `NEGOTIATE::`, `BOOK_TOKEN::`,
`CHECKIN_OK::`, `CHECKIN_HELP::`, `RATE_`, `Pay ₹99 to Lock`,
`Your Kashmir Cab Quotes Are In`, `DRIVER:`.

Also freeze: `lib/whatsapp/webhook/parseInboundAction.ts` payload grammar.

## Report: six readiness dimensions

Score each independently. "MSG91 WhatsApp is done" requires all six — do not
average into one percentage.

| Dimension | Phase that can close it | ✅ criteria |
|-----------|-------------------------|------------|
| 1. Client | 1–3 | No `graph.facebook.com` on WhatsApp **send** path. MSG91 uses `authkey` + `integrated_number`. Next (`lib/msg91/` or `sendAuthTemplateOtp.ts`) **and** Deno (`supabase/functions/_shared/msg91WhatsApp.ts` or `whatsapp.ts`) both MSG91. Return type still `{ configured, success, waMessageId?, error? }`. |
| 2. Credentials | 0–1 | `MSG91_AUTH_KEY` and `MSG91_WHATSAPP_INTEGRATED_NUMBER` set in target env. OTP template name/namespace/language set once Phase 2 is in play. Edge secrets via `supabase secrets` (Deno does not read `.env.local`). |
| 3. Templates | 0 | All 9 types from `whatsapp-templates.md` recorded. Green **only** if the user reported MSG91 dashboard approval. Never invent status. Out-of-window messages (vendor notify, pre-pickup, mid-trip, review) are **not** production-ready on session APIs alone. |
| 4. Webhook | 4 | Live path parses MSG91 Webhook (New). WAMID (`uuid`) dedupe. `read` → `quote_snapshots.viewed`. Fast 200 + job enqueue. Meta HMAC is **not** the live verification path. |
| 5. Handler freeze | every phase | Handler bodies/button ids/titles unchanged vs templates doc. `parseInboundAction` grammar unchanged. Job types unchanged. `sendOtpSms.ts` still stub. |
| 6. Live evidence | 5 | Integration doc §10 journey on a **consumer** WhatsApp number (not WABA→WABA). Phone.Email still works when WhatsApp send fails. Duplicate webhook ignored. |

**Phase-scoped scoring:** After Phase N, only dimensions that phase can close
need ✅. Later dimensions stay ❌. Handler freeze must stay ✅ after every
phase that touched code.

Report format: one line per dimension with status symbol + one-sentence
evidence (cite `file` or env key). Then overall verdict: which phase is
complete, which is next.

## Do not

- Mark credentials or templates done because a code path exists
- Invent MSG91 template approval status
- Treat leftover Meta webhook code as "MSG91 webhook done"
- Require MSG91 SMS — Phone.Email is the OTP fallback
- Re-run full `kashmirbnb-spec-audit` from here
- Implement the next build phase from this skill — hand off to
  **msg91-whatsapp-build**

## Related skills

- **msg91-whatsapp-build** — implement the next MSG91 phase
- **whatsapp-feature-audit** — Plan §6–§7 product completeness (not transport)
- **whatsapp-template-submission** — draft/track templates in MSG91 dashboard
- **verification-before-completion** — required before claiming a dimension closed
