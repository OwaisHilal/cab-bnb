---
name: whatsapp-template-submission
description: >-
  Guides drafting and tracking Meta WhatsApp Cloud API message template
  submissions for Kashmir BnB Cabs' 9 message types (OTP auth template plus
  8 utility/marketing templates for quotes, negotiation, vendor notification,
  confirmation card, and lifecycle events). Use when the user asks to submit,
  draft, approve, or track WhatsApp templates, or asks about Meta template
  categories/approval status.
disable-model-invocation: true
---

# WhatsApp Template Submission

## Context

`ref/kashmirbnb_whatsapp_engineering_plan (2).md` §6 already specifies the
body/button text for every message type, and that text is already hardcoded
in the handlers below. §11: "WhatsApp template messages must be pre-approved
by Meta... plan template submission lead time (24–48h typical)... authentication
templates have a distinct approval category from utility/marketing templates."

This skill turns already-coded message bodies into submittable Meta template
drafts. It does not write application code and does not have Meta API access
— submission and approval happen in Meta Business Manager by the user; this
skill drafts the content and tracks status.

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
   `templates.md`.
3. **Hand off for manual submission.** This environment has no Meta API
   access — the user submits each draft in Meta Business Manager
   (WhatsApp Manager → Message Templates) with the category from the
   inventory table above. Do not claim a template is submitted or approved
   unless the user reports it.
4. **Record approval status** in `templates.md` as the user reports back
   (pending / approved / rejected + reason).
5. **Wire approved templates into code only when asked.** Follow the
   existing `WHATSAPP_OTP_TEMPLATE_NAME` env-var pattern in
   `lib/whatsapp/sendAuthTemplateOtp.ts` — e.g. add
   `WHATSAPP_QUOTE_TEMPLATE_NAME`, switch the relevant handler from a
   free-form interactive/text send to a `type: "template"` send with the
   approved name and `{{n}}` parameters. This is a code change — get
   explicit confirmation before making it, and note it will require
   `whatsapp-feature-audit`'s "Template approval" dimension to be re-scored.

## Do not

- Submit templates to Meta on the user's behalf — no API access exists here.
- Invent or assume an approval status; only record what the user reports.
- Change message wording/structure without sign-off — approved copy is
  locked by Meta; edits require re-submission.
- Switch a handler to `type: "template"` sends before the user confirms the
  template name is actually approved.

## Related skills

- **whatsapp-feature-audit** — checks overall WhatsApp readiness, including
  this dimension
- **kashmirbnb-build** — implement the next Checklist phase
