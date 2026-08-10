-- =====================================================================
-- Migration 0005: Bookings
-- =====================================================================
do $$ begin
  create type booking_status as enum (
    'draft','payment_pending','token_locked','fully_paid',
    'vendor_confirming','vendor_confirmed',
    'driver_attach_pending','driver_attached',
    'ready_for_pickup','in_trip','completed',
    'cancelled','refund_pending','refunded',
    'quote_negotiating','no_response_exception'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('unpaid','token_paid','partially_paid','fully_paid','refund_pending','refunded','failed');
exception when duplicate_object then null; end $$;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_ref text not null unique,
  tourist_id uuid not null references public.tourists(id),
  trip_request_id uuid references public.trip_requests(id),
  winning_quote_snapshot_id uuid references public.quote_snapshots(id),
  vendor_id uuid references public.vendors(id),
  vehicle_type_id bigint references public.vehicle_types(id),
  status booking_status not null default 'draft',
  payment_status payment_status not null default 'unpaid',
  lock_type text check (lock_type in ('full_payment','token_99')),
  final_quote numeric(12,2),
  pickup_at timestamptz not null,
  trip_days int not null default 1,
  pax_count int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_bookings_tourist on public.bookings(tourist_id);
create index if not exists idx_bookings_status on public.bookings(status);
create index if not exists idx_bookings_vendor on public.bookings(vendor_id);
create index if not exists idx_bookings_pickup_at on public.bookings(pickup_at);

drop trigger if exists trg_bookings_updated_at on public.bookings;
create trigger trg_bookings_updated_at before update on public.bookings
for each row execute function public.set_updated_at();

-- booking_ref generator: BK-YYYYMMDD-XXXXX
create or replace function public.generate_booking_ref()
returns text
language plpgsql
as $$
declare
  ref text;
begin
  ref := 'BK-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 5));
  return ref;
end;
$$;
