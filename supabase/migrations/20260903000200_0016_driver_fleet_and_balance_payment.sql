-- 0016: driver/vehicle directory, remaining-balance payment intents, post-token jobs.
-- Assumes 0015 (whatsapp_payment_intents) is applied first.
-- Do not run itself against production — apply from the SQL editor or `db push`.

-- ---------------------------------------------------------------------------
-- Fleet directory
-- ---------------------------------------------------------------------------
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  full_name text not null,
  phone_e164 text not null,
  phone_last10 text generated always as (
    right(regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g'), 10)
  ) stored,
  photo_url text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_drivers_vendor_phone_last10
  on public.drivers (vendor_id, phone_last10);

create index if not exists idx_drivers_vendor_status
  on public.drivers (vendor_id, status);

drop trigger if exists trg_drivers_updated_at on public.drivers;
create trigger trg_drivers_updated_at before update on public.drivers
for each row execute function public.set_updated_at();

alter table public.drivers enable row level security;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  vehicle_type_id bigint references public.vehicle_types(id),
  registration_number text not null,
  model text,
  stock_photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_vehicles_vendor_registration
  on public.vehicles (vendor_id, registration_number);

create index if not exists idx_vehicles_vendor_type
  on public.vehicles (vendor_id, vehicle_type_id);

drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at before update on public.vehicles
for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;

create table if not exists public.driver_vehicle_links (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique (driver_id, vehicle_id)
);

create unique index if not exists idx_driver_vehicle_links_primary
  on public.driver_vehicle_links (driver_id)
  where is_primary;

alter table public.driver_vehicle_links enable row level security;

alter table public.bookings
  add column if not exists driver_id uuid references public.drivers(id) on delete set null;

alter table public.bookings
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;

create index if not exists idx_bookings_driver on public.bookings (driver_id);
create index if not exists idx_bookings_vehicle on public.bookings (vehicle_id);

-- ---------------------------------------------------------------------------
-- Payment intents: purpose + booking (0015 quote_snapshot_id stays NOT NULL)
-- ---------------------------------------------------------------------------
alter table public.whatsapp_payment_intents
  add column if not exists purpose text not null default 'token_lock';

alter table public.whatsapp_payment_intents
  drop constraint if exists whatsapp_payment_intents_purpose_check;

alter table public.whatsapp_payment_intents
  add constraint whatsapp_payment_intents_purpose_check
  check (purpose in ('token_lock', 'balance'));

alter table public.whatsapp_payment_intents
  add column if not exists booking_id uuid references public.bookings(id) on delete set null;

create index if not exists idx_whatsapp_payment_intents_booking
  on public.whatsapp_payment_intents (booking_id);

drop index if exists public.idx_whatsapp_payment_intents_open_quote;

create unique index if not exists idx_whatsapp_payment_intents_open_token
  on public.whatsapp_payment_intents (quote_snapshot_id)
  where purpose = 'token_lock' and status in ('pending', 'sent');

create unique index if not exists idx_whatsapp_payment_intents_open_balance
  on public.whatsapp_payment_intents (booking_id)
  where purpose = 'balance' and status in ('pending', 'sent') and booking_id is not null;

-- ---------------------------------------------------------------------------
-- Storage: public header images for MSG91 payment_link (HTTPS fetch)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('driver-cards', 'driver-cards', true)
on conflict (id) do update set public = true;

drop policy if exists "driver_cards_public_read" on storage.objects;
-- Public bucket GET-by-path is enough for MSG91 header fetch.
-- Do not grant SELECT to anon/authenticated: that would list driver faces.

-- ---------------------------------------------------------------------------
-- finalize_quote_booking: guest ack first, vendor notify delayed 3s on token_99
-- ---------------------------------------------------------------------------
create or replace function public.finalize_quote_booking(
  p_quote_snapshot_id uuid,
  p_lock_type text
)
returns table (booking_id uuid, booking_ref text)
language plpgsql
as $$
declare
  v_snapshot record;
  v_trip_request record;
  v_payment_status public.payment_status;
  v_booking_ref text;
  v_booking_id uuid;
  v_attempt int := 0;
begin
  if p_lock_type not in ('full_payment', 'token_99') then
    raise exception 'invalid_lock_type';
  end if;

  select * into v_snapshot
  from public.quote_snapshots
  where id = p_quote_snapshot_id
  for update;

  if not found then
    raise exception 'quote_snapshot_not_found';
  end if;

  if v_snapshot.status in ('finalized', 'lost', 'expired') then
    raise exception 'quote_snapshot_not_negotiable';
  end if;

  select * into v_trip_request
  from public.trip_requests
  where id = v_snapshot.trip_request_id;

  if v_trip_request.tourist_id is null then
    raise exception 'tourist_not_verified';
  end if;

  v_payment_status := case p_lock_type
    when 'token_99' then 'token_paid'
    else 'fully_paid'
  end;

  loop
    v_attempt := v_attempt + 1;
    v_booking_ref := public.generate_booking_ref();
    begin
      insert into public.bookings (
        booking_ref, tourist_id, trip_request_id, winning_quote_snapshot_id,
        vendor_id, vehicle_type_id, status, payment_status, lock_type,
        final_quote, pickup_at, trip_days, pax_count
      ) values (
        v_booking_ref, v_trip_request.tourist_id, v_trip_request.id, v_snapshot.id,
        v_snapshot.vendor_id, v_snapshot.vehicle_type_id, 'vendor_confirming', v_payment_status, p_lock_type,
        v_snapshot.current_quote, v_trip_request.trip_start_date::timestamptz, v_trip_request.trip_days, v_trip_request.pax_count
      )
      returning id into v_booking_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'booking_ref_generation_failed';
      end if;
    end;
  end loop;

  update public.quote_snapshots
  set status = 'finalized'
  where id = p_quote_snapshot_id;

  update public.quote_snapshots
  set status = 'lost'
  where trip_request_id = v_snapshot.trip_request_id
    and id <> p_quote_snapshot_id
    and status not in ('finalized', 'lost');

  update public.trip_requests
  set status = 'booked'
  where id = v_trip_request.id;

  if p_lock_type = 'token_99' then
    insert into public.job_queue (job_type, payload, run_after)
    values (
      'send_token_received_ack',
      jsonb_build_object('booking_id', v_booking_id),
      now()
    );
    insert into public.job_queue (job_type, payload, run_after)
    values (
      'notify_vendor_booking',
      jsonb_build_object('booking_id', v_booking_id),
      now() + interval '3 seconds'
    );
  else
    insert into public.job_queue (job_type, payload)
    values ('notify_vendor_booking', jsonb_build_object('booking_id', v_booking_id));
  end if;

  return query select v_booking_id, v_booking_ref;
end;
$$;

revoke execute on function public.finalize_quote_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_quote_booking(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
insert into public.whatsapp_message_templates (
  template_key,
  msg91_template_name,
  category,
  send_method,
  body_template,
  dashboard_body,
  footer_template,
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
  'token_received_v1',
  'token_received_v1',
  'UTILITY',
  'bulk_template',
  E'Payment received. Your ₹99 token is confirmed.\n\nTrip: {{trip_summary}}\nOperator: {{vendor_name}}\n\nWe are allocating a driver for you. This can take about 30 minutes.',
  E'Payment received. Your ₹99 token is confirmed.\n\nTrip: {{1}}\nOperator: {{2}}\n\nWe are allocating a driver for you. This can take about 30 minutes.',
  null,
  '[]'::jsonb,
  null,
  '{"trip_summary":"days · pax · cab type · pickup → drop","vendor_name":"selected vendor"}'::jsonb,
  'MSG91_TOKEN_RECEIVED_TEMPLATE_NAME',
  'MSG91_TOKEN_RECEIVED_TEMPLATE_NAMESPACE',
  true,
  'lib/whatsapp/sendTokenReceivedAck.ts',
  'Must be created Green on MSG91. Body cannot start or end with a variable. Session text is the fallback.'
),
(
  'vendor_assign_driver_v1',
  'vendor_assign_driver_v1',
  'UTILITY',
  'bulk_template',
  E'New booking confirmed.\n\nGuest: {{guest_name}}\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nPax: {{pax_count}} | Cab: {{vehicle_label}}\nTotal: {{trip_total}}\n\nReply with the driver''s 10-digit mobile to assign.\nOptional: DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>',
  E'New booking confirmed.\n\nGuest: {{1}}\nRoute: {{2}} → {{3}}\nDate: {{4}}, {{5}} {{6}}\nPax: {{7}} | Cab: {{8}}\nTotal: {{9}}\n\nReply with the driver''s 10-digit mobile to assign.\nOptional: DRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>',
  null,
  '[]'::jsonb,
  null,
  '{"guest_name":"","pickup":"","drop":"","pickup_date":"","trip_days":"","day_label":"","pax_count":"","vehicle_label":"","trip_total":"final_quote × trip_days"}'::jsonb,
  'MSG91_VENDOR_NOTIFY_TEMPLATE_NAME',
  'MSG91_VENDOR_NOTIFY_TEMPLATE_NAMESPACE',
  true,
  'lib/whatsapp/notifyVendorBooking.ts',
  'Does not replace vendor_booking_notify_v1. Create Green on MSG91. Session text fallback if not approved.'
),
(
  'driver_assigned_payment_v1',
  'driver_assigned_payment_v1',
  'SESSION',
  'session_payment_link',
  E'Your driver has been assigned.\n\nTrip: {{trip_summary}}\n{{vendor_line}}\nDriver: {{driver_name}} · {{vehicle_line}}\nTotal: {{trip_total}} · Token paid: ₹99 · Balance: {{balance_due}}',
  null,
  'Pay remaining balance to confirm.',
  '[]'::jsonb,
  null,
  '{"trip_summary":"","vendor_line":"","driver_name":"","vehicle_line":"","trip_total":"","balance_due":""}'::jsonb,
  null,
  null,
  false,
  'lib/whatsapp/sendBalancePaymentLink.ts',
  'Not a dashboard Utility template. MSG91 session payment_link (Cashfree). Header image is the composed driver/car card. CRQID = balance intent id.'
)
on conflict (template_key) do update set
  msg91_template_name = excluded.msg91_template_name,
  category = excluded.category,
  send_method = excluded.send_method,
  body_template = excluded.body_template,
  dashboard_body = excluded.dashboard_body,
  footer_template = excluded.footer_template,
  buttons = excluded.buttons,
  list_config = excluded.list_config,
  variable_schema = excluded.variable_schema,
  env_name_key = excluded.env_name_key,
  env_namespace_key = excluded.env_namespace_key,
  requires_dashboard_create = excluded.requires_dashboard_create,
  wired_in_code = excluded.wired_in_code,
  notes = excluded.notes,
  active = true,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Demo fleet (phones match lib/demo/postTokenBookingFlow.ts DEMO_VENDOR_DRIVERS)
-- photo_url left null — compose falls back to public/demo/drivers then Storage.
-- ---------------------------------------------------------------------------
insert into public.drivers (id, vendor_id, full_name, phone_e164, status)
values
  ('33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111101', 'Bilal Ahmed', '+919876500001', 'active'),
  ('33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111102', 'Rashid Khan', '+919876500002', 'active'),
  ('33333333-3333-3333-3333-333333333303', '11111111-1111-1111-1111-111111111103', 'Imran Dar', '+919876500003', 'active'),
  ('33333333-3333-3333-3333-333333333304', '11111111-1111-1111-1111-111111111104', 'Adil Mir', '+919876500004', 'active')
on conflict (id) do update set
  full_name = excluded.full_name,
  phone_e164 = excluded.phone_e164,
  status = excluded.status;

insert into public.vehicles (id, vendor_id, vehicle_type_id, registration_number, model)
values
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111101', 1, 'JK01NO1234', 'Dzire'),
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111102', 1, 'JK01OL5678', 'Etios'),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111103', 1, 'JK01AA9012', 'Amaze'),
  ('44444444-4444-4444-4444-444444444404', '11111111-1111-1111-1111-111111111104', 1, 'JK01UB3456', 'Swift Dzire')
on conflict (id) do update set
  vehicle_type_id = excluded.vehicle_type_id,
  registration_number = excluded.registration_number,
  model = excluded.model;

insert into public.driver_vehicle_links (id, driver_id, vehicle_id, is_primary)
values
  ('55555555-5555-5555-5555-555555555501', '33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', true),
  ('55555555-5555-5555-5555-555555555502', '33333333-3333-3333-3333-333333333302', '44444444-4444-4444-4444-444444444402', true),
  ('55555555-5555-5555-5555-555555555503', '33333333-3333-3333-3333-333333333303', '44444444-4444-4444-4444-444444444403', true),
  ('55555555-5555-5555-5555-555555555504', '33333333-3333-3333-3333-333333333304', '44444444-4444-4444-4444-444444444404', true)
on conflict (driver_id, vehicle_id) do update set is_primary = excluded.is_primary;

-- ---------------------------------------------------------------------------
-- Job claim: honor run_after so delayed vendor notify is not starved
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_jobs(p_job_types text[], p_limit int)
returns setof public.job_queue
language plpgsql
as $$
begin
  return query
  update public.job_queue
  set status = 'processing', attempts = attempts + 1, updated_at = now()
  where id in (
    select id from public.job_queue
    where status = 'queued'
      and run_after <= now()
      and job_type = any(p_job_types)
    order by run_after, created_at
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

revoke execute on function public.claim_due_jobs(text[], int) from public, anon, authenticated;
grant execute on function public.claim_due_jobs(text[], int) to service_role;

-- ---------------------------------------------------------------------------
-- Message log: MSG91 submitted + demo simulated statuses
-- ---------------------------------------------------------------------------
alter table public.whatsapp_message_log
  drop constraint if exists whatsapp_message_log_wa_status_check;

alter table public.whatsapp_message_log
  add constraint whatsapp_message_log_wa_status_check
  check (wa_status in (
    'accepted',
    'sent',
    'delivered',
    'read',
    'failed',
    'replied',
    'submitted',
    'demo_simulated'
  ));
