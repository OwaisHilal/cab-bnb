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
  ('11111111-1111-1111-1111-111111111101', 'Nova Cabs', 'nova-cabs', 'whatsapp_only', 'active', 'Srinagar', array['Srinagar','Gulmarg','Pahalgam'], '+919999900001'),
  ('11111111-1111-1111-1111-111111111102', 'Ola Cabs', 'ola-cabs', 'whatsapp_only', 'active', 'Srinagar', array['Srinagar','Sonamarg'], '+919999900002'),
  ('11111111-1111-1111-1111-111111111103', 'Aala Cabs', 'aala-cabs', 'whatsapp_only', 'active', 'Srinagar', array['Gulmarg','Srinagar','Yusmarg'], '+919999900003'),
  ('11111111-1111-1111-1111-111111111104', 'Uber', 'uber', 'whatsapp_only', 'active', 'Srinagar', array['Srinagar','Gulmarg','Pahalgam','Sonamarg'], '+919999900004')
on conflict (id) do update set
  business_name = excluded.business_name,
  slug = excluded.slug,
  onboarding_stage = excluded.onboarding_stage,
  status = excluded.status,
  primary_city = excluded.primary_city,
  coverage_cities = excluded.coverage_cities,
  whatsapp_number = excluded.whatsapp_number;

-- vehicle_type_id 1 = sedan, 2 = suv, 3 = tempo (seeded in order by
-- migration 20260810000100_0001_core_actors.sql).

insert into public.vendor_rate_bands
  (id, vendor_id, vehicle_type_id, vehicle_model, pax_min, pax_max, trip_days_min, trip_days_max, season_quarter, min_quote, max_quote)
values
  -- Nova Cabs
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101', 1, 'Dzire', 1, 8, 1, 14, 'ALL_YEAR', 7000, 9000),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111101', 2, 'Ertiga', 1, 7, 1, 14, 'ALL_YEAR', 9000, 11000),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111101', 3, 'Tempo Traveller', 5, 20, 1, 14, 'ALL_YEAR', 15000, 18000),

  -- Ola Cabs
  ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111102', 1, 'Etios', 1, 8, 1, 14, 'ALL_YEAR', 7200, 9200),
  ('22222222-2222-2222-2222-222222222205', '11111111-1111-1111-1111-111111111102', 2, 'Innova', 1, 7, 1, 14, 'ALL_YEAR', 8800, 10800),
  ('22222222-2222-2222-2222-222222222206', '11111111-1111-1111-1111-111111111102', 3, 'Tempo Traveller', 5, 20, 1, 14, 'ALL_YEAR', 14500, 17500),

  -- Aala Cabs
  ('22222222-2222-2222-2222-222222222207', '11111111-1111-1111-1111-111111111103', 1, 'Amaze', 1, 8, 1, 14, 'ALL_YEAR', 6800, 8800),
  ('22222222-2222-2222-2222-222222222208', '11111111-1111-1111-1111-111111111103', 2, 'Innova Crysta', 1, 7, 1, 14, 'ALL_YEAR', 9200, 11200),
  ('22222222-2222-2222-2222-222222222209', '11111111-1111-1111-1111-111111111103', 3, 'Tempo Traveller', 5, 20, 1, 14, 'ALL_YEAR', 15200, 18200),

  -- Uber
  ('22222222-2222-2222-2222-222222222210', '11111111-1111-1111-1111-111111111104', 1, 'Swift Dzire', 1, 8, 1, 14, 'ALL_YEAR', 7100, 9100),
  ('22222222-2222-2222-2222-222222222211', '11111111-1111-1111-1111-111111111104', 2, 'Ertiga', 1, 7, 1, 14, 'ALL_YEAR', 9100, 11100),
  ('22222222-2222-2222-2222-222222222212', '11111111-1111-1111-1111-111111111104', 3, 'Tempo Traveller', 5, 20, 1, 14, 'ALL_YEAR', 14800, 17800)
on conflict (id) do nothing;

-- WhatsApp message templates (same seed as migration 0012)
insert into public.whatsapp_message_templates (
  template_key,
  msg91_template_name,
  category,
  send_method,
  body_template,
  dashboard_body,
  buttons,
  list_config,
  variable_schema,
  env_name_key,
  env_namespace_key,
  requires_dashboard_create,
  wired_in_code,
  notes
) values
  (
    'otp_verification',
    'otp_verification',
    'AUTHENTICATION',
    'bulk_template',
    'Your Kashmir BnB Cabs verification code is {{code}}. Do not share this code with anyone.',
    'Your Kashmir BnB Cabs verification code is {{1}}. Do not share this code with anyone.',
    '[{"type":"OTP_COPY_CODE","label":"Copy code"}]'::jsonb,
    null,
    '{"code":"6-digit OTP"}'::jsonb,
    'MSG91_OTP_TEMPLATE_NAME',
    'MSG91_OTP_TEMPLATE_NAMESPACE',
    true,
    'lib/whatsapp/sendAuthTemplateOtp.ts',
    'Authentication template — bulk API only wired send today.'
  ),
  (
    'quote_single_v1',
    'quote_single_v1',
    'UTILITY',
    'session_list',
    E'Your Kashmir Cab Quote 🚖\n\n{{vendor_name}}: {{price_per_day}}/day ({{vehicle_label}})',
    E'Your Kashmir Cab Quote 🚖\n\n{{1}}: ₹{{2}}/day ({{3}})',
    '[{"type":"QUICK_REPLY","label":"Pay ₹99 to Lock"}]'::jsonb,
    '{"buttonText":"Choose operator","sectionTitle":"Pay ₹99 to lock","rowIdPrefix":"BOOK_TOKEN::"}'::jsonb,
    '{"vendor_name":"","price_per_day":"","vehicle_label":"","quote_snapshot_id":""}'::jsonb,
    'MSG91_QUOTE_SINGLE_TEMPLATE_NAME',
    'MSG91_QUOTE_SINGLE_TEMPLATE_NAMESPACE',
    true,
    'lib/whatsapp/templateCatalog.ts → buildQuoteSingleMessage',
    'Runtime uses session list with dynamic BOOK_TOKEN row ids.'
  ),
  (
    'quote_multi_v1',
    'quote_multi_v1',
    'UTILITY',
    'session_list',
    E'Your Kashmir Cab Quotes Are In 🚖\n\n{{quote_lines}}',
    E'Your Kashmir Cab Quotes Are In 🚖\n\n{{1}}',
    '[]'::jsonb,
    '{"buttonText":"Choose operator","sectionTitle":"Pay ₹99 to lock","rowIdPrefix":"BOOK_TOKEN::"}'::jsonb,
    '{"quote_lines":"newline-separated vendor lines"}'::jsonb,
    'MSG91_QUOTE_MULTI_TEMPLATE_NAME',
    'MSG91_QUOTE_MULTI_TEMPLATE_NAMESPACE',
    true,
    'lib/whatsapp/templateCatalog.ts → buildQuoteMultiMessage',
    'Session list — one row per vendor quote.'
  ),
  (
    'driver_balance_v1',
    'driver_balance_v1',
    'UTILITY',
    'session_button',
    E'Your driver has been assigned 🚗\nOperator: {{vendor_name}}\n\nBalance due: {{balance_due}} (after ₹99 token).\nComplete payment here to unlock your driver''s contact number.',
    E'Your driver has been assigned 🚗\nOperator: {{1}}\nBalance due: ₹{{2}} (after ₹99 token).\nComplete payment here to unlock your driver''s contact number.',
    '[{"type":"QUICK_REPLY","label":"Pay balance Now"}]'::jsonb,
    null,
    '{"vendor_name":"","balance_due":"","booking_id":""}'::jsonb,
    'MSG91_DRIVER_BALANCE_TEMPLATE_NAME',
    'MSG91_DRIVER_BALANCE_TEMPLATE_NAMESPACE',
    true,
    'lib/whatsapp/templateCatalog.ts → buildDriverBalanceMessage',
    'Button title dynamic: Pay {{balance_due}} Now'
  ),
  (
    'vendor_booking_notify_v1',
    'vendor_booking_notify_v1',
    'UTILITY',
    'session_text',
    E'New booking confirmed 🎉\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nPax: {{pax_count}} | Vehicle: {{vehicle_label}}\nPrice: {{final_quote}}/day\n\nReply in this format to assign driver:\nDRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>\n\nExample:\nDRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire',
    E'New booking confirmed 🎉\nRoute: {{1}} → {{2}}\nDate: {{3}}, {{4}} {{5}}\nPax: {{6}} | Vehicle: {{7}}\nPrice: ₹{{8}}/day\n\nReply in this format to assign driver:\nDRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>\n\nExample:\nDRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire',
    '[]'::jsonb,
    null,
    '{"pickup":"","drop":"","pickup_date":"","trip_days":"","day_label":"","pax_count":"","vehicle_label":"","final_quote":""}'::jsonb,
    'MSG91_VENDOR_NOTIFY_TEMPLATE_NAME',
    'MSG91_VENDOR_NOTIFY_TEMPLATE_NAMESPACE',
    true,
    'supabase/functions/_shared/handlers/notifyVendorBooking.ts',
    'Production vendor notify — session text.'
  ),
  (
    'vendor_booking_notify_demo',
    'vendor_booking_notify_v1',
    'UTILITY',
    'session_text',
    E'New booking confirmed for {{vendor_name}} 🎉\nGuest: {{guest_name}} ({{guest_phone}})\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nPax: {{pax_count}} | Vehicle: {{vehicle_label}}\nAgreed quote: {{final_quote}}/day\n\nReply in this format to assign driver:\nDRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>',
    null,
    '[]'::jsonb,
    null,
    '{"vendor_name":"","guest_name":"","guest_phone":"","pickup":"","drop":"","pickup_date":"","trip_days":"","day_label":"","pax_count":"","vehicle_label":"","final_quote":""}'::jsonb,
    null,
    null,
    false,
    'lib/demo/postTokenBookingFlow.ts',
    'Demo vendor copy with guest name + phone — log key vendor_booking_notify_v1.'
  ),
  (
    'driver_contact_v1',
    'driver_contact_v1',
    'UTILITY',
    'session_text',
    E'Payment received ✅\nYour driver: {{driver_name}}\nCall / WhatsApp: {{driver_phone}}\nVehicle: {{vehicle_model}} ({{vehicle_number}})\nOperator: {{vendor_name}}\nDriver will reach out before pickup. Safe travels!',
    E'Payment received ✅\nYour driver: {{1}}\nCall / WhatsApp: {{2}}\nVehicle: {{3}} ({{4}})\nOperator: {{5}}\nDriver will reach out before pickup. Safe travels!',
    '[]'::jsonb,
    null,
    '{"driver_name":"","driver_phone":"","vehicle_model":"","vehicle_number":"","vendor_name":""}'::jsonb,
    'MSG91_DRIVER_CONTACT_TEMPLATE_NAME',
    'MSG91_DRIVER_CONTACT_TEMPLATE_NAMESPACE',
    true,
    'lib/whatsapp/templateCatalog.ts → buildDriverContactMessage',
    null
  ),
  (
    'driver_assignment_v1',
    'driver_assignment_v1',
    'UTILITY',
    'session_text',
    E'New ride assigned, {{driver_name}} 🚗\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nGuest: {{guest_name}} ({{guest_phone}})\nYour vehicle: {{vehicle_model}} ({{vehicle_number}})\nPlease contact the guest before pickup. Safe drive!',
    E'New ride assigned, {{1}} 🚗\nRoute: {{2}} → {{3}}\nDate: {{4}}, {{5}} {{6}}\nGuest: {{7}} ({{8}})\nYour vehicle: {{9}} ({{10}})\nPlease contact the guest before pickup. Safe drive!',
    '[]'::jsonb,
    null,
    '{"driver_name":"","pickup":"","drop":"","pickup_date":"","trip_days":"","day_label":"","guest_name":"","guest_phone":"","vehicle_model":"","vehicle_number":""}'::jsonb,
    'MSG91_DRIVER_ASSIGNMENT_TEMPLATE_NAME',
    'MSG91_DRIVER_ASSIGNMENT_TEMPLATE_NAMESPACE',
    true,
    'supabase/functions/_shared/handlers/completeBalancePayment.ts',
    'Sent to driver phone — not guest mock chat.'
  ),
  (
    'customer_confirmation_v1',
    'customer_confirmation_v1',
    'UTILITY',
    'session_image',
    E'Your Cab Is Confirmed ✅\nDriver: {{driver_name}}\nVehicle: {{vehicle_model}} ({{vehicle_number}})\nPickup: {{pickup_time}} — {{pickup_location}}\nVendor: {{vendor_name}}',
    E'Your Cab Is Confirmed ✅\nDriver: {{1}}\nVehicle: {{2}} ({{3}})\nPickup: {{4}} — {{5}}\nVendor: {{6}}',
    '[]'::jsonb,
    null,
    '{"driver_name":"","vehicle_model":"","vehicle_number":"","pickup_time":"","pickup_location":"","vendor_name":""}'::jsonb,
    'MSG91_CONFIRMATION_TEMPLATE_NAME',
    'MSG91_CONFIRMATION_TEMPLATE_NAMESPACE',
    true,
    'supabase/functions/_shared/handlers/sendConfirmationCard.ts',
    null
  ),
  (
    'pre_pickup_reminder_v1',
    'pre_pickup_reminder_v1',
    'UTILITY',
    'session_text',
    E'Reminder: your Kashmir cab pickup is tomorrow 🚗\n{{driver_line}}\nNeed help? Reply to this message and our support team will assist.',
    E'Reminder: your Kashmir cab pickup is tomorrow 🚗\n{{1}}\nNeed help? Reply to this message and our support team will assist.',
    '[]'::jsonb,
    null,
    '{"driver_line":""}'::jsonb,
    'MSG91_PRE_PICKUP_TEMPLATE_NAME',
    'MSG91_PRE_PICKUP_TEMPLATE_NAMESPACE',
    true,
    'supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts',
    null
  ),
  (
    'lifecycle_day1_checkin',
    'lifecycle_day1_checkin',
    'SESSION',
    'session_button',
    'How was your pickup this morning?',
    null,
    '[{"title":"All Good","payloadPrefix":"CHECKIN_OK::"},{"title":"Report Issue","payloadPrefix":"CHECKIN_HELP::"}]'::jsonb,
    null,
    '{"lifecycle_event_id":""}'::jsonb,
    null,
    null,
    false,
    'supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts',
    'No MSG91 dashboard template.'
  ),
  (
    'lifecycle_post_trip_review',
    'lifecycle_post_trip_review',
    'SESSION',
    'session_button',
    'How was your trip? Tap a rating below.',
    null,
    '[{"title":"Excellent","payloadPrefix":"RATE_5::"},{"title":"Okay","payloadPrefix":"RATE_3::"},{"title":"Poor","payloadPrefix":"RATE_1::"}]'::jsonb,
    null,
    '{"booking_id":""}'::jsonb,
    null,
    null,
    false,
    'supabase/functions/_shared/handlers/dispatchLifecycleEvents.ts',
    'No MSG91 dashboard template.'
  )
on conflict (template_key) do update set
  msg91_template_name = excluded.msg91_template_name,
  category = excluded.category,
  send_method = excluded.send_method,
  body_template = excluded.body_template,
  dashboard_body = excluded.dashboard_body,
  buttons = excluded.buttons,
  list_config = excluded.list_config,
  variable_schema = excluded.variable_schema,
  env_name_key = excluded.env_name_key,
  env_namespace_key = excluded.env_namespace_key,
  requires_dashboard_create = excluded.requires_dashboard_create,
  wired_in_code = excluded.wired_in_code,
  notes = excluded.notes,
  active = excluded.active,
  updated_at = now();
