---
name: whatsapp-template-submission
description: >-
  Guides drafting and tracking WhatsApp message templates for Kashmir BnB
  Cabs' 9 message types (OTP auth plus 8 utility templates). Primary
  submission path is the MSG91 dashboard (Meta still approves behind MSG91).
  Use when the user asks to submit, draft, approve, or track WhatsApp
  templates, or asks about template categories/approval status.
disable-model-invocation: true
---

# WhatsApp Template Submission

## Context

`ref/kashmirbnb_whatsapp_engineering_plan (2).md` §6 already specifies the
body/button text for every message type, and that text is already hardcoded
in the handlers below. §11: "WhatsApp template messages must be pre-approved
by Meta... plan template submission lead time (24–48h typical)... authentication
templates have a distinct approval category from utility/marketing templates."

This skill turns already-coded message bodies into submittable template
drafts. It does not write application code and does not submit via API —
the user submits in the **MSG91 dashboard** (WhatsApp → Templates). Meta
still approves behind MSG91. This skill drafts the content and tracks
status the user reports. Copy source: `docs/whatsapp-templates.md`.

## Template inventory

| # | Message type | Handler | Meta category | Current body (hardcoded) |
|---|---|---|---|---|
| 1 | OTP verification | `lib/whatsapp/sendAuthTemplateOtp.ts` | AUTHENTICATION | Code parameter only — verify exact shape against the real approved template before relying on it |
| 2 | Consolidated quote | `supabase/functions/_shared/handlers/sendQuotes.ts` | UTILITY | "Your Kashmir Cab Quotes Are In" + per-vendor lines + 3 buttons |
| 3 | Negotiation response | `supabase/functions/_shared/handlers/computeNegotiation.ts` | UTILITY | "Here's our next offer: ₹{amount}/day" / final-offer variant + buttons |
| 4 | Vendor booking notification | `supabase/functions/_shared/handlers/notifyVendorBooking.ts` | UTILITY | "New booking confirmed" + route/date/pax/price + DRIVER: format instructions |
| 5 | Customer confirmation card | `supabase/functions/_shared/handlers/sendConfirmationCard.ts` | UTILITY | "Your Cab Is Confirmed" + driver/vehicle/pickup/vendor, optional image |
| 6 | Pre-pickup reminder | `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts` | UTILITY | "Reminder: your Kashmir cab pickup is tomorrow" + driver line |
| 7 | Day-1 check-in | `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts` | UTILITY | "How was your pickup this morning?" + 2 buttons |
| 8 | Mid-trip wellness | `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts` | UTILITY | "Everything going smoothly on your trip so far?" + 2 buttons |
| 9 | Post-trip review | `supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts` | UTILITY | "How was your trip? Tap a rating below." + 3 rating buttons |

Approval status column intentionally omitted here — track it in a
`templates.md` companion file next to this SKILL.md (create on first use),
since it changes over time and this file should stay a stable reference.

## Workflow

1. **Extract variables.** Convert each hardcoded body to Meta's `{{n}}`
   placeholder syntax (e.g. vendor name, quote amount, driver name become
   `{{1}}`, `{{2}}`, ...). Do not change the wording itself without the
   user's sign-off — copy changes can restart Meta's review clock.
2. **Pick a template name** per message type (e.g. `quote_consolidated_v1`,
   `negotiation_offer_v1`, `vendor_booking_notify_v1`) and record it in
   `docs/whatsapp-templates.md` (approval tracker).
3. **Hand off for manual submission.** The user submits each draft in the
   MSG91 dashboard (WhatsApp → Templates) with the category from the
   inventory table above. See `docs/msg91-whatsapp-integration.md` §4.
   Do not claim a template is submitted or approved unless the user reports
   it.
4. **Record approval status** in `docs/whatsapp-templates.md` (approval
   tracker) and/or `templates.md` as the user reports back (pending /
   approved / rejected + reason). Green only if the user said so.
5. **Wire approved templates into code only when asked** via
   **msg91-whatsapp-build** (not by editing handlers here). Use MSG91
   env-var names (`MSG91_OTP_TEMPLATE_NAME`, namespace, language) — not
   new Meta Graph template sends. Get explicit confirmation the template
   is approved before wiring. Re-score **msg91-whatsapp-audit** Templates.

## Do not

- Submit templates on the user's behalf — no dashboard/API session here.
- Invent or assume an approval status; only record what the user reports.
- Change message wording/structure without sign-off — approved copy is
  locked; edits require re-submission.
- Switch a handler to template sends before the user confirms the template
  name is actually approved.
- Reintroduce `graph.facebook.com` template sends — transport is MSG91.

## Related skills

- **msg91-whatsapp-audit** — transport + template-approval dimension
- **msg91-whatsapp-build** — wire approved MSG91 templates in the matching phase
- **whatsapp-feature-audit** — Plan §6–§7 product completeness
- **kashmirbnb-build** — implement the next Checklist phase
