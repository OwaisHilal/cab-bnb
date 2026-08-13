-- =====================================================================
-- Fixture seed data — Checklist Phase 5 "fixture bands" test gate
-- =====================================================================
-- Applied automatically by `supabase db reset` (see supabase/config.toml
-- [db.seed] sql_paths). Safe to re-run against an already-seeded database
-- (local or the linked remote project) — every insert uses a fixed id and
-- `on conflict (id) do nothing`.
--
-- Without this, `vendor_rate_bands` is empty, matchVendorRateBands.ts
-- (lib/matching/matchVendorRateBands.ts) always returns matched_vendor_count
-- = 0, and the frontend booking flow (features/booking-request/hooks/
-- useBookingFlow.ts) intentionally never reaches the dispatch animation or
-- OTP sheet in that case — it shows an inline "no operators available"
-- error instead. Seeding these rows is what lets the full flow run.
--
-- Coverage:
--   - pax 1-20, trip_days 1-14 to span the frontend's full UI range
--     (features/booking-request/constants.ts MIN/MAX_PAX_COUNT,
--     MIN/MAX_TRIP_DAYS).
--   - season_quarter = 'ALL_YEAR' on every row so matches never depend on
--     which calendar quarter trip_start_date resolves to
--     (lib/matching/resolveSeasonQuarter.ts).
--   - sedan bands intentionally widen pax_max to 8 (beyond the vehicle's
--     literal 4-seat capacity) so a 7-pax sedan request still matches and
--     computeVehicleRecommendation() in matchVendorRateBands.ts can compare
--     "N sedans" vs "1 SUV" cost and recommend the SUV — this is required
--     for the checklist's "7-pax sedan recommendation test" gate.

insert into public.vendors (id, business_name, slug, onboarding_stage, status, primary_city, coverage_cities, whatsapp_number)
values
  ('11111111-1111-1111-1111-111111111101', 'Zabarwan Cabs', 'zabarwan-cabs', 'whatsapp_only', 'active', 'Srinagar', array['Srinagar','Gulmarg','Pahalgam'], '+919999900001'),
  ('11111111-1111-1111-1111-111111111102', 'Dal Lake Travels', 'dal-lake-travels', 'whatsapp_only', 'active', 'Srinagar', array['Srinagar','Sonamarg'], '+919999900002'),
  ('11111111-1111-1111-1111-111111111103', 'Gulmarg Fleet Services', 'gulmarg-fleet-services', 'whatsapp_only', 'active', 'Gulmarg', array['Gulmarg','Srinagar','Yusmarg'], '+919999900003')
on conflict (id) do nothing;

-- vehicle_type_id 1 = sedan, 2 = suv, 3 = tempo (seeded in order by
-- migration 20260810000100_0001_core_actors.sql).

insert into public.vendor_rate_bands
  (id, vendor_id, vehicle_type_id, vehicle_model, pax_min, pax_max, trip_days_min, trip_days_max, season_quarter, min_quote, max_quote)
values
  -- Zabarwan Cabs
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101', 1, 'Dzire', 1, 8, 1, 14, 'ALL_YEAR', 7000, 9000),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111101', 2, 'Ertiga', 1, 7, 1, 14, 'ALL_YEAR', 9000, 11000),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111101', 3, 'Tempo Traveller', 5, 20, 1, 14, 'ALL_YEAR', 15000, 18000),

  -- Dal Lake Travels
  ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111102', 1, 'Etios', 1, 8, 1, 14, 'ALL_YEAR', 7200, 9200),
  ('22222222-2222-2222-2222-222222222205', '11111111-1111-1111-1111-111111111102', 2, 'Innova', 1, 7, 1, 14, 'ALL_YEAR', 8800, 10800),
  ('22222222-2222-2222-2222-222222222206', '11111111-1111-1111-1111-111111111102', 3, 'Tempo Traveller', 5, 20, 1, 14, 'ALL_YEAR', 14500, 17500),

  -- Gulmarg Fleet Services
  ('22222222-2222-2222-2222-222222222207', '11111111-1111-1111-1111-111111111103', 1, 'Amaze', 1, 8, 1, 14, 'ALL_YEAR', 6800, 8800),
  ('22222222-2222-2222-2222-222222222208', '11111111-1111-1111-1111-111111111103', 2, 'Innova Crysta', 1, 7, 1, 14, 'ALL_YEAR', 9200, 11200),
  ('22222222-2222-2222-2222-222222222209', '11111111-1111-1111-1111-111111111103', 3, 'Tempo Traveller', 5, 20, 1, 14, 'ALL_YEAR', 15200, 18200)
on conflict (id) do nothing;
