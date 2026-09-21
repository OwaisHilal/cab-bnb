-- 0024: public Storage bucket for source vehicle/car stock photos.
-- Same rationale as `driver-photos` (0023): a durable place for ops to
-- upload a car's stock photo and get back a public HTTPS URL to paste into
-- `vehicles.stock_photo_url` (see lib/drivers/composeDriverCard.ts), instead
-- of relying on the local/demo-only public/fleet/<code>.png fallback.
-- Do not run itself against production — apply from the SQL editor or `db push`.

insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "vehicle_photos_public_read" on storage.objects;
-- Public bucket GET-by-path is enough for composeDriverCard.ts's server-side
-- fetch and any direct HTTPS use. No SELECT (list) grant to
-- anon/authenticated, matching driver-cards/driver-photos.
