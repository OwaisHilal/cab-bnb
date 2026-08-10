-- =====================================================================
-- Migration 0001: Core Actors (tourists, vendors, vehicle_types)
-- =====================================================================
create extension if not exists pgcrypto;

create table if not exists public.tourists (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone_e164 text not null unique,
  whatsapp_number text,
  email text,
  country_code text,
  preferred_currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tourists is 'End customers booking cab packages.';

do $$ begin
  create type vendor_onboarding_stage as enum ('whatsapp_only','hybrid','portal_active');
exception when duplicate_object then null; end $$;

do $$ begin
  create type vendor_status as enum ('active','paused','blacklisted');
exception when duplicate_object then null; end $$;

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  slug text unique,
  onboarding_stage vendor_onboarding_stage not null default 'whatsapp_only',
  status vendor_status not null default 'active',
  primary_city text,
  coverage_cities text[] not null default '{}',
  reliability_score numeric(4,2) not null default 3.00,
  whatsapp_number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendors is 'Cab vendor businesses; whatsapp_number is the primary dispatch number.';

create table if not exists public.vehicle_types (
  id bigserial primary key,
  code text not null unique,
  label text not null,
  icon_key text not null,
  seat_capacity int not null,
  luggage_capacity int,
  sort_order int not null default 100,
  is_active boolean not null default true
);

insert into public.vehicle_types (code, label, icon_key, seat_capacity, sort_order)
values
  ('sedan','Sedan','sedan',4,10),
  ('suv','SUV','suv',6,20),
  ('tempo','Tempo Traveller','tempo',12,30)
on conflict (code) do nothing;

-- updated_at trigger fn (shared across tables)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tourists_updated_at on public.tourists;
create trigger trg_tourists_updated_at before update on public.tourists
for each row execute function public.set_updated_at();

drop trigger if exists trg_vendors_updated_at on public.vendors;
create trigger trg_vendors_updated_at before update on public.vendors
for each row execute function public.set_updated_at();
