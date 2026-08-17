---
name: kashmirbnb-build
description: >-
  Implements Kashmir BnB features following the Supabase checklist build order
  and engineering plan product rules. Use when the user asks to implement,
  build, scaffold, or start the next phase, migration, route, or Edge Function
  for Kashmir BnB Cabs.
disable-model-invocation: true
---

# Kashmir BnB Build

## Requirement documents

| Doc | Path | Use for |
|-----|------|---------|
| **Plan** | `ref/kashmirbnb_whatsapp_engineering_plan (2).md` | Product rules, algorithms, messages, state machines |
| **Checklist** | `ref/kashmirbnb_supabase_implementation_checklist (1).md` | Exact files, migrations, routes, functions, verify steps |

**Phase detail:** [phases.md](phases.md)

## Before writing code

1. Read the relevant Checklist phase section in full
2. Read linked Plan sections (e.g. Checklist 3.1 → Plan §3.2, §3.3)
3. Confirm prior phases are done — do not skip migrations or job_queue before webhook
4. Run `@kashmirbnb-spec-audit` if unsure of current state

## Build order (strict)

Do not reorder without user approval:

```
Phase 0  → supabase init, env, lib/supabase clients
Phase 1  → migrations 0001_core_actors … 0008_rls_policies
Phase 2  → routes 2.1–2.4 (trip-requests + OTP)
         → wire Edge Function 3.1 into 2.1
Phase 2b → Edge Function 3.2 (send-quotes) + 3.10 (job-queue-worker) + route 2.8 (cron)
Phase 2c → route 2.5 (webhook) + functions 3.3, 3.4 (negotiate, finalize)
Phase 2d → functions 3.5, 3.6 (vendor notify, parse driver)
Phase 2e → function 3.7 (confirmation card) + 3.8, 3.9 (lifecycle, expiry)
Phase 2f → admin routes 2.6, 2.7
Phase 4  → frontend wiring
Phase 5  → test gates before marking complete
```

## Implementation rules

### Architecture

- **Service role** only in server routes, Edge Functions, cron — never in browser
- **Job queue** for all WhatsApp/SMS/email sends — no sync WhatsApp send in webhook or OTP verify response
- **Webhook** returns 200 immediately after enqueueing job
- **Quote match** on trip-request POST — no WhatsApp, no vendor contact
- **OTP verify** enqueues `send_quotes` job — does not send inline

### Code layout

```
supabase/migrations/<timestamp>_000N_<name>.sql
app/api/<route>/route.ts
supabase/functions/<kebab-name>/index.ts
lib/supabase/server.ts
lib/supabase/client.ts
```

Migration names should follow Checklist: `0001_core_actors`, `0002_rate_bands`, etc.

### Env vars (Phase 0)

Required in `.env.local` and hosting:

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MSG91_AUTH_KEY`, `MSG91_WHATSAPP_INTEGRATED_NUMBER`, `MSG91_OTP_TEMPLATE_NAME`, `MSG91_OTP_TEMPLATE_NAMESPACE`, `MSG91_OTP_TEMPLATE_LANGUAGE`, `MSG91_OTP_TEMPLATE_ID`, `SMS_PROVIDER_API_KEY`, `EMAIL_PROVIDER_API_KEY`, `CRON_SECRET`

WhatsApp transport is MSG91 (not direct Meta Graph). See **msg91-whatsapp-build**. Customer OTP is MSG91 **SMS SendOTP** first (`MSG91_OTP_TEMPLATE_ID`); WhatsApp auth-template OTP is `prefer=whatsapp`; Phone.Email when the chosen channel fails. `SMS_PROVIDER_API_KEY` is unused. Legacy `WHATSAPP_ACCESS_TOKEN` / `PHONE_NUMBER_ID` / `VERIFY_TOKEN` / `APP_SECRET` are retired by MSG91 Phase 5.

Add `.env.example` with keys only (no secrets).

### Security (non-negotiable)

- Never return `min_quote`, `negotiation_step_min`, `negotiation_step_max` to client
- OTP: hash at rest, rate limit send (3/10min), expiry 5min, max attempts 5
- Verify inbound WhatsApp webhooks (MSG91 Webhook (New) once **msg91-whatsapp-build** Phase 4 is done)
- `wa_message_id` unique for idempotency

### Per-phase completion

Before moving to next phase:

1. Run Checklist **Verify:** steps for that phase
2. Run Phase 5 gates that apply (see Checklist Phase 5)
3. Use **verification-before-completion** skill — evidence before claims

## Phase 0 deliverables

- [ ] `supabase init` + link project
- [ ] Extensions: `pgcrypto`, `pg_cron`
- [ ] `lib/supabase/server.ts` and `client.ts`
- [ ] `.env.local` + `.env.example`

## Phase 1 deliverables

- [ ] Migrations 0001–0008 apply via `supabase db reset` locally
- [ ] Seed `vehicle_types` (3 rows)
- [ ] Fixture vendor + rate bands for manual match test

## Phase 2+ deliverables

See [phases.md](phases.md) for route and function checklist per step.

## When user says "implement next phase"

1. Audit or grep repo to find last completed phase
2. State which phase you are starting and list deliverables
3. Implement only that phase — minimal diff
4. Run verify steps and report results with evidence

## Do not

- Skip migrations or invent alternate table names
- Contact vendors at quote-request time
- Send WhatsApp synchronously in request handlers
- Mark phase complete without running verify commands

## Related skills

- **kashmirbnb-spec-audit** — gap check before/after build
- **msg91-whatsapp-build** — MSG91 WhatsApp transport phases 0–5
- **msg91-whatsapp-audit** — MSG91 transport readiness gate
- **verification-before-completion** — required before claiming done
