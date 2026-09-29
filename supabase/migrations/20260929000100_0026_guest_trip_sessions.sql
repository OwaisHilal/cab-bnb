-- One verified browser tab per row. A second tab or device inserts its own
-- session_id instead of replacing trip_requests.session_id, so the first tab
-- keeps polling the same trip. Service role only: RLS is on and there is no
-- anon policy, matching trip_requests.

create table if not exists public.guest_trip_sessions (
  session_id text primary key,
  trip_request_id uuid not null references public.trip_requests(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_guest_trip_sessions_trip
  on public.guest_trip_sessions (trip_request_id);

alter table public.guest_trip_sessions enable row level security;
