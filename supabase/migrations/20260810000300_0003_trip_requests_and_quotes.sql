-- =====================================================================
-- Migration 0003: Trip Requests + Quote Snapshots
-- =====================================================================
create table if not exists public.trip_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  tourist_id uuid references public.tourists(id),
  pickup_location text,
  drop_location text,
  trip_start_date date not null,
  trip_days int not null default 1,
  pax_count int not null,
  requested_vehicle_type_id bigint references public.vehicle_types(id),
  recommended_vehicle_type_id bigint references public.vehicle_types(id),
  recommendation_reason text,
  status text not null default 'matching'
    check (status in ('matching','quotes_ready','otp_pending','quotes_sent','negotiating','booked','expired','abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_trip_requests_session on public.trip_requests(session_id);
create index if not exists idx_trip_requests_tourist on public.trip_requests(tourist_id);
create index if not exists idx_trip_requests_status on public.trip_requests(status);

drop trigger if exists trg_trip_requests_updated_at on public.trip_requests;
create trigger trg_trip_requests_updated_at before update on public.trip_requests
for each row execute function public.set_updated_at();

do $$ begin
  create type quote_channel as enum ('whatsapp','sms','email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quote_snapshot_status as enum ('pending_send','sent','viewed','negotiating','finalized','expired','lost');
exception when duplicate_object then null; end $$;

create table if not exists public.quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  trip_request_id uuid not null references public.trip_requests(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  vendor_rate_band_id uuid not null references public.vendor_rate_bands(id),
  vehicle_type_id bigint not null references public.vehicle_types(id),
  initial_quote numeric(12,2) not null,
  min_quote_floor numeric(12,2) not null,
  current_quote numeric(12,2) not null,
  negotiation_round int not null default 0,
  negotiation_history jsonb not null default '[]'::jsonb,
  is_best_price boolean not null default false,
  status quote_snapshot_status not null default 'pending_send',
  sent_channel quote_channel,
  wa_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quote_snapshots_trip on public.quote_snapshots(trip_request_id);
create index if not exists idx_quote_snapshots_vendor on public.quote_snapshots(vendor_id);
create index if not exists idx_quote_snapshots_status on public.quote_snapshots(status);

drop trigger if exists trg_quote_snapshots_updated_at on public.quote_snapshots;
create trigger trg_quote_snapshots_updated_at before update on public.quote_snapshots
for each row execute function public.set_updated_at();
