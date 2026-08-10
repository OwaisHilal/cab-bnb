-- =====================================================================
-- Migration 0002: Vendor Rate Bands (pricing configuration engine)
-- =====================================================================
do $$ begin
  create type season_quarter as enum ('Q1','Q2','Q3','Q4','PEAK','OFF_PEAK','ALL_YEAR');
exception when duplicate_object then null; end $$;

create table if not exists public.vendor_rate_bands (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  vehicle_type_id bigint not null references public.vehicle_types(id),
  vehicle_model text,
  pax_min int not null,
  pax_max int not null,
  trip_days_min int not null default 1,
  trip_days_max int not null default 1,
  season_quarter season_quarter not null default 'ALL_YEAR',
  min_quote numeric(12,2) not null,
  max_quote numeric(12,2) not null,
  negotiation_step_min numeric(12,2) not null default 50,
  negotiation_step_max numeric(12,2) not null default 150,
  max_negotiation_rounds int not null default 3,
  is_active boolean not null default true,
  priority int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_range check (min_quote <= max_quote),
  constraint valid_pax check (pax_min <= pax_max),
  constraint valid_days check (trip_days_min <= trip_days_max),
  constraint valid_negotiation_step check (negotiation_step_min <= negotiation_step_max)
);

comment on table public.vendor_rate_bands is 'Configurable vendor pricing bands used by the matching algorithm. No hardcoded pricing logic.';

create index if not exists idx_rate_bands_lookup
  on public.vendor_rate_bands (vehicle_type_id, pax_min, pax_max, trip_days_min, trip_days_max, season_quarter)
  where is_active = true;

create index if not exists idx_rate_bands_vendor
  on public.vendor_rate_bands (vendor_id);

drop trigger if exists trg_rate_bands_updated_at on public.vendor_rate_bands;
create trigger trg_rate_bands_updated_at before update on public.vendor_rate_bands
for each row execute function public.set_updated_at();
