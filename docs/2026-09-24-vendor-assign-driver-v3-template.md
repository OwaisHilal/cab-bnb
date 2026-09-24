# `vendor_assign_driver_v3` — simplify the CTA copy

**Status:** ☑ Created via MSG91's API on 2026-09-23 (`template_id 2949504098758945`) → ☑ Approved by Meta/WhatsApp on 2026-09-24 (`status: approved`) → ☑ Code + DB catalog wired on 2026-09-24 → ☑ Migration applied to the linked Supabase project (`supabase db push`) and `.env.local` updated on 2026-09-24 → ☐ still needs `MSG91_VENDOR_NOTIFY_TEMPLATE_NAME` updated to `vendor_assign_driver_v3` on Vercel (all environments) + redeploy, since that's a separate manual step from the local env file.

---

## Why this template exists

`vendor_assign_driver_v2`'s body ended with two lines vendors found hard to
scan on a phone:

```
Reply with the driver's 10-digit mobile to assign.
Optional: DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>
```

Most vendors never used the `DRIVER: ...` free-text shortcut — they either
replied with just the phone number or used the new "Assign driver" web
form. `vendor_assign_driver_v3` keeps the exact same 9 body variables and
the same one dynamic **"Assign driver" URL button** as v2 (so this is a
low-risk re-review, same shape as the v1 → v2 button-only change), and only
replaces the trailing two lines with one shorter line that also references
the button:

```
Reply with the driver's 10-digit mobile number, or tap Assign driver below.
```

## Update 2026-09-23 — created via API

Built and reviewed with the same pattern as v2:

- **Reviewable builder + test:** `lib/whatsapp/vendorAssignDriverCreateTemplateV3.ts` →
  `buildVendorAssignDriverV3CreateApiBody()`. Covered by
  `lib/whatsapp/vendorAssignDriverCreateTemplateV3.test.ts` (does not start/end with a
  variable, keeps the same 9 numbered variables, drops the `Optional: DRIVER:` line,
  uses the simplified CTA copy).
- **Dry-run then live script:** `scripts/msg91-create-vendor-assign-driver-v3.ts`
  (`npm run msg91:create-vendor-assign-v3`, then `-- --live`) printed the JSON for
  review first, then POSTed it to
  `https://api.msg91.com/api/v5/whatsapp/client-panel-template/`.
- **MSG91's response** (HTTP 200):
  ```json
  {
    "status": "success",
    "hasError": false,
    "data": {
      "message": "template creation in process. Please wait till the template is being approved from vendor",
      "template_id": "2949504098758945",
      "backup_templates": []
    },
    "errors": null
  }
  ```
- Creating v3 here did not switch live traffic — `vendor_assign_driver_v2` stayed the
  default while v3 was pending, checked with
  `node scripts/msg91-check-template-status.mjs vendor_assign_driver_v3`.

## Update 2026-09-24 — approved, code + DB catalog wired

`vendor_assign_driver_v3` is `status: approved`. Code/catalog changes made to switch
to it, `template_key` staying `vendor_assign_driver_v1` throughout (same v1→v2
precedent in `docs/2026-09-21-vendor-assign-driver-v2-template.md`):

- `lib/whatsapp/templateEnv.ts` — `vendor_assign_driver_v1`'s `defaultName` now
  `vendor_assign_driver_v3` (fallback when the env var is unset).
- New migration `supabase/migrations/20260924000100_0026_vendor_assign_driver_v3.sql` —
  updates the `vendor_assign_driver_v1` row's `msg91_template_name` and
  `body_template` to the v3 copy.
- Both in-memory fallback catalogs (`lib/whatsapp/messageTemplateStore.ts`,
  `supabase/functions/_shared/messageTemplateStore.ts`) updated to
  `msg91_template_name: "vendor_assign_driver_v3"` + the v3 body copy, matching the
  migration.
- `supabase/functions/_shared/templateMessages.ts` — `MSG91_VENDOR_ASSIGN_DRIVER_TEMPLATE_NAME`
  fallback constant updated to `"vendor_assign_driver_v3"`.
- `lib/whatsapp/notifyVendorBooking.ts` / `supabase/functions/_shared/templateMessages.ts` —
  dropped the `Fastest way: tap "Assign driver" below…` line that used to be appended
  after the rendered template body for the session/`cta_url` fallback path. v3's
  approved body already ends with `...or tap Assign driver below.`, so appending it
  again would have duplicated that instruction. The bulk-template send path is
  unaffected either way (it never sent that appended line — MSG91 reads the literal
  body from the approved template on their side).
- Comment-only updates (no behavior change): `supabase/functions/_shared/vendorAssignToken.ts`,
  `supabase/functions/_shared/handlers/notifyVendorBooking.ts`,
  `lib/whatsapp/notifyVendorBooking.test.ts` (test title).
- `npm test` and `npm run build` both pass after these changes.

**Update 2026-09-24 — migration applied, local env updated:** `.env.local`'s
`MSG91_VENDOR_NOTIFY_TEMPLATE_NAME` (which was explicitly set and overrides the code
default above) was updated to `vendor_assign_driver_v3`, and the new migration was
applied to the linked Supabase project via `supabase db push` (`migration list`
confirms `20260924000100` now matches on both `local` and `remote`).

**Still needed before this is live in production:** Vercel's production
environment variables still have `MSG91_VENDOR_NOTIFY_TEMPLATE_NAME` set to
`vendor_assign_driver_v2` — update it to `vendor_assign_driver_v3` for every
environment you test in, then redeploy. This remains a manual step done directly in
the Vercel dashboard/CLI.

---

## Reference

- Precedent for this exact "keep the same variables/button, tighten the copy"
  switch: `docs/2026-09-21-vendor-assign-driver-v2-template.md` (v1 → v2, added the
  button).
- Signed token generation: `lib/whatsapp/vendorAssignToken.ts` →
  `signVendorAssignToken` / `buildVendorAssignTokenAndUrl`. Mirrored for Supabase
  Edge Functions in `supabase/functions/_shared/vendorAssignToken.ts`.
