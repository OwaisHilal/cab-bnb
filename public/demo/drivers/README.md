# Demo driver photos

Local/demo fallback used by `lib/drivers/composeDriverCard.ts` when a booking's
`drivers.photo_url` is empty. Matching is by the driver's full name
(case-insensitive), against the seeded demo roster in
`supabase/migrations/20260903000200_0016_driver_fleet_and_balance_payment.sql`.

Add these exact filenames (PNG or JPEG content is fine either way — the
extension in the map below is what actually gets requested):

| Driver name (seed) | Expected file |
|---------------------|---------------|
| Bilal Ahmed | `bilal-ahmed.png` |
| Rashid Khan | `rashid-khan.png` |
| Imran Dar | `imran-dar.png` |
| Adil Mir | `adil-mir.png` |

**This folder is local/demo-only.** In production, set `drivers.photo_url` to a
public HTTPS URL (e.g. a Supabase Storage object) — `composeDriverCard.ts`
tries that first and only falls back to this folder when `photo_url` is null
or unset. `localhost` / signed URLs will not work — MSG91 must be able to
fetch the URL from the public internet without expiring.

If neither a DB URL nor a matching file here exists, the driver-card is
generated with the car photo only (no driver portrait) — this is a
best-effort image sent ahead of the `Pay Balance` message and never blocks
the actual payment link.
