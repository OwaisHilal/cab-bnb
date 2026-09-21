-- 0023: public Storage bucket for source driver/vehicle portraits.
-- Separate from the `driver-cards` bucket (0016), which only holds the
-- composed JPEG cards that sendBalancePaymentLink.ts sends to WhatsApp.
-- This bucket holds the *raw* uploads that back `drivers.photo_url` /
-- `vehicles.stock_photo_url` (see lib/drivers/composeDriverCard.ts), so ops
-- has one durable place to upload a driver's face or a car's stock photo
-- and get back a public HTTPS URL to paste into those columns.
-- Do not run itself against production — apply from the SQL editor or `db push`.

insert into storage.buckets (id, name, public)
values ('driver-photos', 'driver-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "driver_photos_public_read" on storage.objects;
-- Public bucket GET-by-path is enough for composeDriverCard.ts's server-side
-- fetch and any direct HTTPS use. Do not grant SELECT (list) to
-- anon/authenticated — that would let anyone enumerate every driver's photo
-- filename instead of only fetching a path they already have.
