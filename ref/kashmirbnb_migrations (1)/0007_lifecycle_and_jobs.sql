-- =====================================================================
-- Migration 0007: Lifecycle Events + Job Queue
-- =====================================================================
do $$ begin
  create type lifecycle_event_type as enum (
    'day1_checkin','midtrip_wellness','post_trip_review','driver_assigned_notice','pre_pickup_reminder'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.booking_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type lifecycle_event_type not null,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  customer_response text,
  response_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled','sent','responded','skipped','failed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_lifecycle_booking on public.booking_lifecycle_events(booking_id);
create index if not exists idx_lifecycle_scheduled
  on public.booking_lifecycle_events(scheduled_at) where status = 'scheduled';

create table if not exists public.job_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_job_queue_pending
  on public.job_queue(status, run_after) where status = 'queued';

drop trigger if exists trg_job_queue_updated_at on public.job_queue;
create trigger trg_job_queue_updated_at before update on public.job_queue
for each row execute function public.set_updated_at();
