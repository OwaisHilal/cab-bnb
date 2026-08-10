-- =====================================================================
-- Migration 0006: Driver Detail Submissions + WhatsApp Message Log
-- =====================================================================
create table if not exists public.driver_detail_submissions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  raw_message_text text not null,
  parsed_driver_name text,
  parsed_driver_phone text,
  parsed_vehicle_number text,
  parsed_vehicle_model text,
  parsed_vehicle_type text,
  parse_status text not null default 'pending'
    check (parse_status in ('pending','parsed_ok','parse_failed','ops_corrected')),
  wa_message_id text,
  received_at timestamptz not null default now(),
  parsed_at timestamptz
);

create index if not exists idx_driver_details_booking on public.driver_detail_submissions(booking_id);
create index if not exists idx_driver_details_status on public.driver_detail_submissions(parse_status);

create table if not exists public.whatsapp_message_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  tourist_id uuid references public.tourists(id) on delete set null,
  trip_request_id uuid references public.trip_requests(id) on delete set null,
  quote_snapshot_id uuid references public.quote_snapshots(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound')),
  template_name text,
  body_snapshot text,
  button_payload text,
  interaction_type text check (interaction_type in ('button_click','free_text','list_reply', null)),
  wa_message_id text unique,
  wa_status text check (wa_status in ('accepted','sent','delivered','read','failed','replied')),
  created_at timestamptz not null default now()
);

create index if not exists idx_wa_log_booking on public.whatsapp_message_log(booking_id, created_at desc);
create index if not exists idx_wa_log_vendor on public.whatsapp_message_log(vendor_id, created_at desc);
create index if not exists idx_wa_log_trip_request on public.whatsapp_message_log(trip_request_id);
