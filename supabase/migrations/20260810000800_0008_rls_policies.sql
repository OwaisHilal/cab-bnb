-- =====================================================================
-- Migration 0008: Row Level Security Policies
-- Tourist identity in this app comes from a custom WhatsApp/OTP flow
-- (see otp_verifications, Plan §5/§11), not Supabase Auth. auth.uid()
-- never resolves for these rows, so no anon/authenticated SELECT
-- policies are defined here on purpose (documented skip).
--
-- RLS is still enabled on all four tables as defense in depth: every
-- real read/write goes through the service-role client from Next.js
-- Route Handlers and Edge Functions, which bypasses RLS entirely.
-- Revisit this file if/when Supabase Auth phone sign-in is added for
-- a direct-to-client "my bookings" page.
-- =====================================================================
alter table public.tourists enable row level security;
alter table public.trip_requests enable row level security;
alter table public.bookings enable row level security;
alter table public.quote_snapshots enable row level security;
