-- =====================================================================
-- Migration 0004: OTP Verifications
-- =====================================================================
create table if not exists public.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  phone_e164 text not null,
  otp_code_hash text not null,
  channel text not null default 'sms' check (channel in ('sms','whatsapp')),
  attempts int not null default 0,
  verified boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_otp_session on public.otp_verifications(session_id);
create index if not exists idx_otp_phone on public.otp_verifications(phone_e164);
create index if not exists idx_otp_expiry on public.otp_verifications(expires_at) where verified = false;
