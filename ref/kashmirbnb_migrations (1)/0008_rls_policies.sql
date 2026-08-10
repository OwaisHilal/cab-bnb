-- =====================================================================
-- Migration 0008: Row Level Security Policies
-- NOTE: service_role key (used by Next.js server / Edge Functions) bypasses
-- RLS entirely. These policies only matter if you expose direct client
-- (anon/authenticated) reads later, e.g. a "my bookings" page using
-- Supabase Auth phone sign-in.
-- =====================================================================
alter table public.tourists enable row level security;
alter table public.trip_requests enable row level security;
alter table public.bookings enable row level security;
alter table public.quote_snapshots enable row level security;

drop policy if exists "tourist reads own row" on public.tourists;
create policy "tourist reads own row"
  on public.tourists for select
  using (auth.uid()::text = id::text);

drop policy if exists "tourist reads own trip requests" on public.trip_requests;
create policy "tourist reads own trip requests"
  on public.trip_requests for select
  using (tourist_id in (select id from public.tourists where auth.uid()::text = id::text));

drop policy if exists "tourist reads own bookings" on public.bookings;
create policy "tourist reads own bookings"
  on public.bookings for select
  using (tourist_id in (select id from public.tourists where auth.uid()::text = id::text));

drop policy if exists "tourist reads own quote snapshots" on public.quote_snapshots;
create policy "tourist reads own quote snapshots"
  on public.quote_snapshots for select
  using (trip_request_id in (
    select id from public.trip_requests where tourist_id in (
      select id from public.tourists where auth.uid()::text = id::text
    )
  ));
