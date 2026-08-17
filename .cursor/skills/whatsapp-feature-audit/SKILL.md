---
name: whatsapp-feature-audit
description: >-
  Audits Kashmir BnB Cabs WhatsApp product completeness against Plan §6–§7
  (9 handlers, job queue, OTP hash, inbound actions). Use when the user asks
  whether WhatsApp product flows are implemented. For MSG91 vs Meta Graph
  transport, credentials, and webhook adapter readiness, use msg91-whatsapp-audit.
disable-model-invocation: true
---

# WhatsApp Feature Audit

## Context

Source of truth: `ref/kashmirbnb_whatsapp_engineering_plan (2).md` §5–§7 —
9 message types (OTP auth, consolidated quote, negotiation response, vendor
booking notification, customer confirmation card, pre-pickup reminder,
day-1 check-in, mid-trip wellness, post-trip review), one inbound webhook,
send-via-job-queue architecture. §11 adds the compliance constraint: every
outbound template except a live-session reply needs Meta pre-approval, with
authentication templates (OTP) in a separate approval category from
utility/marketing templates.

This skill is scoped to WhatsApp **product completeness** (Plan §6–§7
handlers, job queue, OTP hash). WhatsApp **transport** (MSG91 vs Meta
Graph) is **msg91-whatsapp-audit** — do not score MSG91 migration here.

For a full-project audit against every Checklist phase, use
**kashmirbnb-spec-audit** instead.

## What's already done — code layer (do not re-litigate every run)

| Area | File | Status |
|---|---|---|
| Send primitives (button/text/image) | `supabase/functions/_shared/whatsapp.ts` | Done |
| OTP auth template send | `lib/whatsapp/sendAuthTemplateOtp.ts` | Done — template shape is a documented guess, see gap 2 |
| Inbound webhook (challenge, signature, dedupe, status→viewed) | `app/api/whatsapp/webhook/route.ts` | Done |
| Inbound action routing (`BOOK_FULL`/`NEGOTIATE`/`CHECKIN_*`/`RATE_*`/`DRIVER:`) | `lib/whatsapp/webhook/parseInboundAction.ts` | Done |
| OTP send/verify (rate limit, hash, expiry, attempt cap) | `app/api/otp/send/route.ts`, `app/api/otp/verify/route.ts` | Done |
| Consolidated quote message | `supabase/functions/_shared/handlers/sendQuotes.ts` | Done |
| Negotiation response | `supabase/functions/_shared/handlers/computeNegotiation.ts` | Done |
| Vendor booking notification | `supabase/functions/_shared/handlers/notifyVendorBooking.ts` | Done |
| Driver-detail free-text parsing | `supabase/functions/_shared/handlers/parseDriverDetails.ts` | Done |
| Customer confirmation card | `supabase/functions/_shared/handlers/sendConfirmationCard.ts` | Done |
| Lifecycle events (pre-pickup, day1, midtrip, review) | `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts` | Done |
| Job queue dispatch | `supabase/functions/job-queue-worker/index.ts`, `app/api/cron/dispatch-jobs/route.ts` | Done |

## What's NOT done — re-grep every run (do not copy as current truth)

1. **Live Graph credentials for quotes.** Until MSG91 Phase 3, Edge `sendWhatsApp*` still needs `WHATSAPP_*`. Blank Graph keys mean quotes/lifecycle cannot send. OTP WhatsApp uses `MSG91_*`, not Graph.
2. **Utility template Green.** Auth OTP may be wired; the other 8 types are still session interactive/text/image until user-reported Green + Phase 3. Use **whatsapp-template-submission**.
3. **Quote SMS/email.** Edge `sendSmsFallback` stays stub. Customer OTP SMS is MSG91 SendOTP (`MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`) — that is **done product**, not this gap. `SMS_PROVIDER_API_KEY` is unused.
4. **No test-gate evidence.** Checklist Phase 5 items relevant to WhatsApp
   (tampered signature rejected, real WA number happy path, double-tap
   negotiate produces no duplicate round, malformed `DRIVER:` → parse_failed
   + ops alert) have no test files or logged runs in the repo.

## Audit workflow

```
Audit progress:
- [ ] Read .env.local — MSG91_* for OTP; WHATSAPP_* still needed for Edge quotes until Phase 3
- [ ] Grep lib/whatsapp/, supabase/functions/_shared/whatsapp.ts, lib/sms/ for TODO/stub/"not configured" markers
- [ ] Re-read each of the 9 handlers — do body/button text and button-count-<=3 still match Plan §6?
- [ ] Confirm webhook still verifies X-Hub-Signature-256 and dedupes on wa_message_id
- [ ] Check for any new template-name env vars (WHATSAPP_*_TEMPLATE_NAME) added since last audit
- [ ] Check for any test files/CI runs covering Checklist Phase 5 WhatsApp gates
- [ ] Score the five readiness dimensions below and write the report
```

Never mark a dimension done without reading the actual file or `.env.local` — a
handler existing does not mean it is live or Meta-approved.

## Report: five readiness dimensions

Score each independently — "WhatsApp is done" requires all five, not just the
first:

| Dimension | ✅ criteria | Current baseline (last audit) |
|---|---|---|
| Code | All 9 handlers + webhook + job queue implemented per Plan §6–§7 | ✅ Done |
| Credentials | Graph `WHATSAPP_*` set if scoring Edge quote send; OTP uses `MSG91_AUTH_KEY` + template vars | Re-grep `.env.local` |
| Template approval | User-reported Green for types in play | Never invent |
| OTP SMS | MSG91 SendOTP live (`MSG91_OTP_TEMPLATE_ID`); quote `sendSmsFallback` still stub | Do not score OTP SMS as a stub gap |
| Live test evidence | Phase 5 WhatsApp gates on a real test number | None unless verified this run |

Report format: one line per dimension with status symbol + one-sentence
evidence, then an overall verdict — do not average into a single percentage
without stating the dimension breakdown, since "code done" and "feature live"
are very different claims.

## Do not

- Mark credentials, template approval, or quote SMS "done" because the
  code path calling them exists — check the actual config/approval state.
- Score live OTP SendOTP as missing SMS fallback.
- Re-run the full `kashmirbnb-spec-audit` scope from here; link to it instead
  if the user wants non-WhatsApp phases covered.
- Draft or submit templates yourself here — hand off to
  **whatsapp-template-submission** (MSG91 dashboard).
- Score MSG91 Graph-replacement readiness here — use
  **msg91-whatsapp-audit**.

## Related skills

- **msg91-whatsapp-audit** — MSG91 transport migration readiness
- **msg91-whatsapp-build** — implement the next MSG91 WhatsApp phase
- **kashmirbnb-spec-audit** — full-project spec audit
- **kashmirbnb-build** — implement the next Checklist phase
- **whatsapp-template-submission** — draft/track template approval (MSG91 dashboard)
- **verification-before-completion** — required before claiming any gap closed
