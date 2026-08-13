---
name: whatsapp-feature-audit
description: >-
  Audits the entire WhatsApp messaging feature for Kashmir BnB Cabs end-to-end
  — code completeness, live credential configuration, Meta template approval
  status, SMS fallback, and test-gate evidence — to determine true
  production-readiness, not just spec compliance. Use when the user asks to
  audit, check progress, check readiness, or ask "is WhatsApp done/live/ready"
  for WhatsApp messaging, templates, OTP, webhook, or lifecycle notifications.
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

This skill is scoped to the WhatsApp feature only. For a full-project audit
against every Checklist phase, use **kashmirbnb-spec-audit** instead.

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

## What's NOT done — the real gaps

1. **Live credentials.** `.env.local`: `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`
   are blank. Every `sendWhatsApp*` call returns `{ configured: false }`; the
   webhook GET/POST both fail without `WHATSAPP_VERIFY_TOKEN`/
   `WHATSAPP_APP_SECRET`. Nothing has sent or received a real message yet.
2. **Meta template approval.** Only OTP has a template code path, and even
   that's unverified against a real approved template's `components` shape
   (see the comment in `sendAuthTemplateOtp.ts`). The other 8 message types
   are sent as free-form interactive/text/image session messages — these
   will fail once sent outside a live 24h customer-service window (vendor
   notification, pre-pickup, midtrip, review are routinely outside that
   window). Use **whatsapp-template-submission** to work this gap.
3. **SMS fallback.** `lib/sms/sendOtpSms.ts` is a stub returning
   `configured: false` always; `SMS_PROVIDER_API_KEY` is blank. No provider
   (MSG91/Twilio) chosen or wired.
4. **No test-gate evidence.** Checklist Phase 5 items relevant to WhatsApp
   (tampered signature rejected, real WA number happy path, double-tap
   negotiate produces no duplicate round, malformed `DRIVER:` → parse_failed
   + ops alert) have no test files or logged runs in the repo.

## Audit workflow

```
Audit progress:
- [ ] Read .env.local — which WHATSAPP_*/SMS_PROVIDER_API_KEY vars are set vs blank?
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
| Credentials | `WHATSAPP_ACCESS_TOKEN`/`PHONE_NUMBER_ID`/`VERIFY_TOKEN`/`APP_SECRET` set in the target environment | ❌ Blank in `.env.local` |
| Template approval | All utility templates + auth template approved in Meta Business Manager, template names wired via env | ❌ Only OTP attempted, unverified shape |
| SMS fallback | Real provider implementing `SmsProvider` in `lib/sms/`, `SMS_PROVIDER_API_KEY` set | ❌ Stub only |
| Live test evidence | Phase 5 WhatsApp gates run and passing on a real test number | ❌ None found |

Report format: one line per dimension with status symbol + one-sentence
evidence, then an overall verdict — do not average into a single percentage
without stating the dimension breakdown, since "code done" and "feature live"
are very different claims.

## Do not

- Mark credentials, template approval, or SMS fallback "done" because the
  code path calling them exists — check the actual config/approval state.
- Re-run the full `kashmirbnb-spec-audit` scope from here; link to it instead
  if the user wants non-WhatsApp phases covered.
- Draft or submit Meta templates yourself here — hand off to
  **whatsapp-template-submission**.

## Related skills

- **kashmirbnb-spec-audit** — full-project spec audit
- **kashmirbnb-build** — implement the next Checklist phase
- **whatsapp-template-submission** — draft/track Meta template approval
- **verification-before-completion** — required before claiming any gap closed
