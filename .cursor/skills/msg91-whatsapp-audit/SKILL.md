---
name: msg91-whatsapp-audit
description: >-
  Audits Kashmir BnB Cabs MSG91 WhatsApp migration for gaps, anomalies, and
  partial work across client, credentials, templates, webhook, handler freeze,
  and live evidence. Use when the user asks to audit MSG91 WhatsApp, check
  phase readiness, find gaps or anomalies, or ask if MSG91 is done or live.
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
| Phases | `.cursor/skills/msg91-whatsapp-build/phases.md` | What each phase must close vs leave open |

This skill scores **transport migration**. For Plan §6–§7 product completeness,
use **whatsapp-feature-audit**.

## Status symbols (required — never collapse to yes/no)

Same taxonomy as **kashmirbnb-spec-audit**. Every finding gets one symbol **and** a stable ID:

| Status | Symbol | ID prefix | Meaning |
|--------|--------|-----------|---------|
| Implemented | ✅ | — | Fully matches the MSG91 docs for that item; cite file |
| Partial | ⚠️ | **P** (`P1`, `P2`, …) | Exists but incomplete, empty, dual-path, or not live |
| Gap | ❌ | **G** (`G1`, `G2`, …) | Required and missing (or not this phase yet — label which) |
| Anomaly | 🔴 | **A** (`A1`, `A2`, …) | Contradicts freeze rules, dual live transports, or invented approval |

Number IDs from 1 in each category every report. Refer to findings as `G1`, `A2`, `P3` in the verdict and in **msg91-whatsapp-build**.

**Never** score a dimension as a single ✅/❌ if it mixes states. Split it into P/G/A rows:

- Keys in `.env.example` empty → **P** (not ✅ Credentials)
- Inventory in `whatsapp-templates.md` with MSG91 column `—` → **P** inventory + **G** user-reported Green
- Graph send still live after Phase 2 OTP swap claimed → **A** (OTP should be MSG91)

**Expected-later vs unexpected:**

- After Phase N, items owned by a **later** phase are **G** with `phase: M` — they are **not** blockers for closing N
- Items owned by Phase N that are missing or half-done are **blockers** (**G** or **P**)
- **A** is always a blocker, any phase

Do not copy the "What's NOT done" list below as current truth — re-grep every run.

## Product layer (do not re-litigate as MSG91 gaps)

These are **done product code**. If they break, that is 🔴 freeze anomaly, not an MSG91 gap.

| Area | File |
|------|------|
| OTP route + Phone.Email fallback | `app/api/otp/send/route.ts` |
| Button/text/image primitives | `supabase/functions/_shared/whatsapp.ts` |
| 8 Edge handlers | `supabase/functions/_shared/handlers/*.ts` |
| Inbound action grammar | `lib/whatsapp/webhook/parseInboundAction.ts` |
| Job queue | `supabase/functions/job-queue-worker/index.ts` |
| SMS OTP stub | `lib/sms/sendOtpSms.ts` — **must stay stub** |

## Audit workflow

```
Audit progress:
- [ ] Confirm scope (full | Phase N)
- [ ] Grep send path: graph.facebook.com, WHATSAPP_ACCESS_TOKEN, MSG91_, api.msg91.com
- [ ] Read sendAuthTemplateOtp.ts and supabase/functions/_shared/whatsapp.ts
- [ ] Read webhook route + parsers (Meta vs MSG91 adapter)
- [ ] Check .env.example and .env.local: MSG91_* present? empty? Graph keys still there?
- [ ] Grep frozen handlers vs whatsapp-templates.md
- [ ] Approval tracker — only user-reported Green
- [ ] Anomaly deep-dive (list below)
- [ ] Write report: counts + gaps + anomalies + partials + dimensions
```

Never mark ✅ without reading the actual file or env.

### Handler freeze grep

Must still match `docs/whatsapp-templates.md`:

- `supabase/functions/_shared/handlers/sendQuotes.ts`
- `supabase/functions/_shared/handlers/computeNegotiation.ts`
- `supabase/functions/_shared/handlers/notifyVendorBooking.ts`
- `supabase/functions/_shared/handlers/sendConfirmationCard.ts`
- `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts`

Frozen: `BOOK_FULL::`, `NEGOTIATE::`, `BOOK_TOKEN::`, `CHECKIN_OK::`,
`CHECKIN_HELP::`, `RATE_`, `Pay ₹99 to Lock`, `Your Kashmir Cab Quotes Are In`,
`DRIVER:`. Also `lib/whatsapp/webhook/parseInboundAction.ts`.

### Anomaly deep-dive (always run)

Flag **A** (`A1`, `A2`, …) with evidence:

1. Handler copy or button `id`/`title` changed vs `whatsapp-templates.md`
2. `parseInboundAction` grammar changed (`BOOK_*` / `DRIVER:` / `RATE_*`)
3. WhatsApp send inside webhook or OTP verify (must stay job_queue)
4. MSG91 SMS wired in `sendOtpSms.ts` (out of scope)
5. Invented template Green / wired template the user did not confirm
6. Next MSG91 client without Deno twin (or the reverse) after Phase 1 claimed
7. OTP still `graph.facebook.com` after Phase 2 claimed complete
8. Edge `whatsapp.ts` still Graph after Phase 3 claimed complete
9. Live webhook still Meta HMAC after Phase 4 claimed complete
10. MSG91 inbound pointed at `/api/whatsapp/webhook` while parser is still `entry[].changes[]`
11. Dual live send paths (Graph **and** MSG91 both reachable for the same message type)
12. `WHATSAPP_*` send env removed before Phase 5 while Graph callers remain

## Six dimensions (score with ⚠️/❌/🔴 splits)

Do not average. "MSG91 WhatsApp is done" needs all six ✅ — not six ⚠️.

| Dim | Phase | ✅ | Typical ⚠️ | Typical ❌ | Typical 🔴 |
|-----|-------|----|------------|------------|------------|
| 1. Client | 1–3 | No Graph on **send** path; Next + Deno MSG91; `authkey` + `integrated_number`; same result contract | Helper exists, call sites still Graph | No `lib/msg91/` / `msg91WhatsApp.ts` | Only one runtime swapped; mixed Graph+MSG91 for same send |
| 2. Credentials | 0–1 | `MSG91_AUTH_KEY` + `INTEGRATED_NUMBER` **non-empty** in target env; Edge `supabase secrets`; OTP template vars when Phase 2+ | Keys in `.env.example` / `.env.local` but empty | Keys missing from `.env.example` after Phase 0 | Secrets committed; Edge still Graph-only after Phase 3 |
| 3. Templates | 0 | User **reported** Green for types in play; names recorded | Inventory in docs, tracker `—` | No inventory / no suggested names | Status marked approved without user report |
| 4. Webhook | 4 | MSG91 Webhook (New) parse; WAMID dedupe; `read` → viewed; not Meta HMAC as live path | URL documented, adapter not built | No adapter after Phase 4 claimed | MSG91 payload on Meta parser in production |
| 5. Handler freeze | every | Copy/payloads/job types/SMS stub unchanged | n/a — freeze is binary | n/a | Any freeze break |
| 6. Live evidence | 5 | Integration §10 on a **consumer** number; Phone.Email still on WhatsApp fail | Partial journey (e.g. OTP only) | No run | Claimed live with blank creds |

Out-of-window messages (vendor notify, pre-pickup, mid-trip, review) stay **P** until Green utility templates — session APIs are not production-ready.

## Report template (mandatory)

Do **not** stop at a six-line dimension table. Always fill **G** / **A** / **P** tables. Sort **A** → **G** blockers → **P**.

```markdown
# MSG91 WhatsApp Audit

**Date:** YYYY-MM-DD
**Scope:** Full | Phase N
**Last claimed phase:** N or none

## Counts

| Status | ID prefix | Count |
|--------|-----------|-------|
| ✅ Implemented | — | N |
| ⚠️ Partial | P | N |
| ❌ Gap | G | N |
| 🔴 Anomaly | A | N |

## Executive summary

[2–4 sentences: what is live vs scaffold vs missing. Cite G1, P2, A1.]

## Dimensions

| Dim | Symbol | Phase owner | Evidence |
| 1. Client | | 1–3 | |
| 2. Credentials | | 0–1 | |
| 3. Templates | | 0 | |
| 4. Webhook | | 4 | |
| 5. Handler freeze | | every | |
| 6. Live evidence | | 5 | |

If a dim is mixed, use ⚠️ on the dim row and split into G/A/P rows below.

## Anomalies (A)

| ID | Expected | Actual | Location |
| A1 | | | |
| (none) | | | |

## Critical gaps (G)

| ID | Item | Phase owner | Blocker for claimed phase? | Evidence |
| G1 | | | yes/no (no = expected-later) | |

## Partial implementations (P)

| ID | Item | Done | Missing |
| P1 | | | |

## Phase readiness

| Phase | Ready to close? | Blockers (G/A/P IDs) |
| 0 Onboarding + env | | |
| 1 MSG91 client | | |
| 2 OTP send | | |
| 3 Edge outbound | | |
| 4 Webhook adapter | | |
| 5 E2E + Graph cleanup | | |

## Verdict

Last phase that may close: N
Next build phase: N+1
Do not start N+1 if claimed N has any **A** or unexpected **G**/**P** on N's deliverables.
```

## Phase 0 example (do not treat as live data)

After Phase 0 scaffold, a **correct** report includes at least:

- **P1** Credentials: five `MSG91_*` keys present, values blank
- **P2** Templates: nine types documented, MSG91 status `—` (no user Green)
- **P3** Dual `WHATSAPP_*` + `MSG91_*` in `.env.example` (expected until Phase 5, not an **A**)
- **G1** Client: still `graph.facebook.com` — phase owner 1–3, **not** a Phase 0 blocker
- **G2** Webhook adapter: not built — phase owner 4, **not** a Phase 0 blocker
- **G3** Live evidence: none — phase owner 5
- **G4** User dashboard: account / Green templates / filled secrets — Phase 0 user work
- ✅ Handler freeze
- **A:** none expected; any freeze break is **A1** and a blocker

A **wrong** Phase 0 report: six yes/no lines and "Phase 0 complete" with no **G** / **A** / **P** tables.

## Do not

- Collapse **P** into ✅ because files exist
- Collapse expected-later **G** into "everything failed"
- Invent MSG91 template approval
- Require MSG91 SMS
- Fix issues unless the user asks after the audit (then cite **G1** / **A1** / **P1**)
- Implement the next build phase from this skill

## Related skills

- **msg91-whatsapp-build** — implement the next MSG91 phase
- **whatsapp-feature-audit** — Plan §6–§7 product completeness
- **whatsapp-template-submission** — draft/track templates; never invent approval
- **kashmirbnb-spec-audit** — full-project gaps/anomalies (not MSG91 transport)
- **verification-before-completion** — evidence before claiming a dimension closed
