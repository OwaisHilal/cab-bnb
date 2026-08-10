---
name: kashmirbnb-spec-audit
description: >-
  Audits Kashmir BnB against the engineering plan and Supabase implementation
  checklist for gaps, anomalies, phase readiness, and spec drift. Use when the
  user asks to audit, check gaps, find anomalies, verify compliance, sprint or
  phase readiness, or compare code to the requirement docs.
disable-model-invocation: true
---

# Kashmir BnB Spec Audit

## Requirement documents (dual source of truth)

Read both before every audit:

| Doc | Path | Role |
|-----|------|------|
| **Plan** | `ref/kashmirbnb_whatsapp_engineering_plan (2).md` | Product behavior, algorithms, state machines, security invariants |
| **Checklist** | `ref/kashmirbnb_supabase_implementation_checklist (1).md` | Migrations, routes, Edge Functions, env vars, build order, verify steps |

**Conflict resolution:**

- **Product behavior** (flows, negotiation rules, vendor timing) → Plan wins
- **File names, migration order, env vars, function names** → Checklist wins
- Checklist defines full base schema (`0001`–`0008`); Plan §4 only extends schema — prefer Checklist for DDL

**Structured checklist:** [checklist.md](checklist.md)

## When to run

- Before or after completing a Checklist phase (0–5)
- Before opening a PR for a major feature
- When user says: audit, gap analysis, spec check, phase readiness, anomaly, what's missing
- After schema, webhook, or job-queue changes

## Audit workflow

```
Audit Progress:
- [ ] Phase 1: Load both requirement docs + set scope
- [ ] Phase 2: Inventory codebase
- [ ] Phase 3: Checklist pass
- [ ] Phase 4: Anomaly deep-dive
- [ ] Phase 5: Mechanical script (optional)
- [ ] Phase 6: Write report
```

### Phase 1: Scope

Default scope if unspecified: **full audit** (all Checklist phases + Plan invariants).

Scoped examples:

- `"Audit Checklist Phase 1 only"` → migrations 0001–0008
- `"Audit WhatsApp flow"` → Plan §5–7 + Checklist Phase 2.5, Phase 3
- `"Security audit"` → Plan §11 + RLS migration 0008

### Phase 2: Inventory

| Area | Where to look |
|------|----------------|
| Migrations | `supabase/migrations/` — expect `0001` through `0008` per Checklist |
| Supabase config | `supabase/config.toml`, linked project |
| API routes | `app/api/` per Checklist Phase 2 |
| Edge Functions | `supabase/functions/` — 10 functions per Checklist Phase 3 |
| Supabase clients | `lib/supabase/server.ts`, `lib/supabase/client.ts` |
| Env | `.env.local`, `.env.example` |
| Frontend | trip form, animation, OTP, Realtime subscriptions |
| Cron | `app/api/cron/dispatch-jobs/route.ts`, Vercel cron config |

### Phase 3: Status per checklist item

| Status | Symbol | Meaning |
|--------|--------|---------|
| Implemented | ✅ | Matches both docs; cite `file:line` or migration |
| Partial | ⚠️ | Exists but incomplete or diverges |
| Gap | ❌ | Not found |
| Anomaly | 🔴 | Contradicts Plan invariants or Checklist design |

Never mark ✅ without reading the actual file or migration.

### Phase 4: Anomaly deep-dive (always run)

Flag 🔴 with evidence:

1. Vendor WhatsApp at quote-request time (Plan §1 — post-commit only)
2. Quotes sent before OTP verify (Plan §5, Checklist 2.4)
3. `min_quote` / `negotiation_step_*` in client or public API (Plan §11)
4. Sync WhatsApp in API route or webhook (Checklist 2.5, 2.8 — job_queue only)
5. Missing `X-Hub-Signature-256` verification (Plan §7.1)
6. Missing `wa_message_id` dedupe (Checklist 0006 unique constraint)
7. Opening price uses `min_quote` instead of `max_quote` (Plan §1, §3.1)
8. Animation uses random vendor count vs `matched_vendor_count` (Plan §5)
9. OTP stored plaintext (Checklist 0004, Plan §11)
10. Negotiation without `SELECT FOR UPDATE` (Checklist 3.3)
11. Sibling snapshots not marked `lost` on booking (Plan §8)
12. Webhook blocks on WhatsApp send instead of fast 200 ack (Checklist 2.5)

### Phase 5: Mechanical scan

From repo root:

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File .cursor/skills/kashmirbnb-spec-audit/scripts/audit-presence.ps1
```

Script output is hints only — confirm by reading source files.

### Phase 6: Report template

```markdown
# Kashmir BnB Spec Audit Report

**Date:** YYYY-MM-DD
**Scope:** [Full | Checklist Phase N | Area]
**Plan:** ref/kashmirbnb_whatsapp_engineering_plan (2).md
**Checklist:** ref/kashmirbnb_supabase_implementation_checklist (1).md

## Summary

| Status | Count |
|--------|-------|
| ✅ Implemented | N |
| ⚠️ Partial | N |
| ❌ Gap | N |
| 🔴 Anomaly | N |

## Executive summary

[2–4 sentences]

## Critical gaps

| ID | Item | Plan/Checklist ref | Evidence |

## Anomalies

| ID | Expected | Actual | Location |

## Partial implementations

| Item | Done | Missing |

## Phase readiness (Checklist)

| Phase | Ready? | Blockers |
|-------|--------|----------|
| 0 Setup | | |
| 1 Migrations 0001-0008 | | |
| 2 Routes 2.1-2.8 | | |
| 3 Edge Functions 3.1-3.10 | | |
| 4 Frontend | | |
| 5 Test gates | | |

## Mechanical scan

[Script output or Skipped]

## Recommended next steps

1. ...
```

Sort: 🔴 → ❌ (blockers) → ⚠️

## Product invariants (Plan §1)

Violations are always 🔴:

- No live vendor ping at quote time
- Quotes from `vendor_rate_bands`, not vendor replies
- Opening price = `max_quote`
- OTP gates WhatsApp delivery (not quote computation)
- Vendor contacted only after booking commit
- Single webhook for all inbound WhatsApp
- Randomized bounded negotiation, server-side only
- All external messaging via `job_queue`

## Do not

- Fix issues unless user asks after audit
- Mark complete from filenames or TODOs alone
- Audit against only one doc when scope is full

## Related skills

- **kashmirbnb-build** — implement the next Checklist phase
- **review-bugbot** — bugs in diffs
- **review-security** — security in diffs
- **verification-before-completion** — before claiming phase done
