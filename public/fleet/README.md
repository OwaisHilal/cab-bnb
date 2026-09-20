# Fleet stock photos

Local/demo fallback used by `lib/drivers/composeDriverCard.ts` when a
booking's `vehicles.stock_photo_url` is empty. Matching is by
`vehicle_types.code` (see `supabase/migrations/20260810000100_0001_core_actors.sql`).

Add these exact filenames (any raster format `sharp` can decode — PNG/JPEG):

| Vehicle type code | Expected file |
|--------------------|---------------|
| `sedan` | `sedan.png` |
| `suv` | `suv.png` |
| `tempo` | `tempo.png` |

`sedan` is the fallback code used when a booking has no resolvable vehicle
type at all.

**This folder is local/demo-only.** In production, set
`vehicles.stock_photo_url` to a public HTTPS URL (e.g. a Supabase Storage
object) — `composeDriverCard.ts` tries that first and only falls back to
this folder when `stock_photo_url` is null or unset. If neither resolves,
a neutral placeholder card is generated instead of failing the send.
