-- MSG91 WhatsApp API simulator — isolated tables for internal twins.
-- Does not write to whatsapp_message_log, job_queue, or bookings.
-- RLS on, no anon policies: service-role from Next.js route handlers only.

create table if not exists public.msg91_sim_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  language text not null default 'en_US',
  template_status text not null default 'pending'
    check (template_status = any (array['pending'::text, 'approved'::text, 'rejected'::text])),
  category text,
  namespace text,
  integrated_number text not null default '*',
  components jsonb not null default '{}'::jsonb,
  raw_request jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, language, integrated_number)
);

create index if not exists idx_msg91_sim_templates_number
  on public.msg91_sim_templates (integrated_number);

create index if not exists idx_msg91_sim_templates_status
  on public.msg91_sim_templates (template_status);

drop trigger if exists trg_msg91_sim_templates_updated_at on public.msg91_sim_templates;
create trigger trg_msg91_sim_templates_updated_at
  before update on public.msg91_sim_templates
  for each row execute function public.set_updated_at();

create table if not exists public.msg91_sim_messages (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  uuid text not null unique,
  direction text not null check (direction = any (array['outbound'::text, 'inbound'::text])),
  content_type text,
  template_name text,
  customer_number text not null,
  integrated_number text not null,
  crqid text,
  wa_status text not null default 'submitted',
  components jsonb not null default '{}'::jsonb,
  raw_request jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_msg91_sim_messages_created
  on public.msg91_sim_messages (created_at);

create index if not exists idx_msg91_sim_messages_request
  on public.msg91_sim_messages (request_id);

create index if not exists idx_msg91_sim_messages_customer
  on public.msg91_sim_messages (customer_number);

create table if not exists public.msg91_sim_groups (
  id text primary key,
  subject text,
  integrated_number text,
  invite_link text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_msg91_sim_groups_updated_at on public.msg91_sim_groups;
create trigger trg_msg91_sim_groups_updated_at
  before update on public.msg91_sim_groups
  for each row execute function public.set_updated_at();

create table if not exists public.msg91_sim_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id text not null references public.msg91_sim_groups (id) on delete cascade,
  wa_id text not null,
  display_name text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (group_id, wa_id)
);

create table if not exists public.msg91_sim_group_join_requests (
  id text primary key,
  group_id text not null references public.msg91_sim_groups (id) on delete cascade,
  wa_id text not null,
  display_name text,
  integrated_number text,
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'approved'::text, 'rejected'::text])),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_msg91_sim_join_req_group
  on public.msg91_sim_group_join_requests (group_id, status);

create table if not exists public.msg91_sim_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  uuid text,
  request_id text,
  payload jsonb not null,
  delivered_to_callback_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_msg91_sim_webhook_created
  on public.msg91_sim_webhook_events (created_at);

create index if not exists idx_msg91_sim_webhook_uuid
  on public.msg91_sim_webhook_events (uuid);

alter table public.msg91_sim_templates enable row level security;
alter table public.msg91_sim_messages enable row level security;
alter table public.msg91_sim_groups enable row level security;
alter table public.msg91_sim_group_members enable row level security;
alter table public.msg91_sim_group_join_requests enable row level security;
alter table public.msg91_sim_webhook_events enable row level security;

-- Simulated approved Kashmir dashboard templates (not a real MSG91 Green claim).
-- integrated_number '*' matches any get-template-client/:number lookup.
insert into public.msg91_sim_templates (
  name, language, template_status, category, namespace, integrated_number, components, raw_request
) values
  (
    'otp_verification', 'en_US', 'approved', 'AUTHENTICATION', null, '*',
    '{"body":"Your Kashmir BnB Cabs verification code is {{1}}. Do not share this code with anyone.","buttons":[{"type":"OTP_COPY_CODE","label":"Copy code"}]}'::jsonb,
    '{"seed":true,"name":"otp_verification"}'::jsonb
  ),
  (
    'quote_single_v1', 'en_US', 'approved', 'UTILITY', null, '*',
    '{"body":"Your Kashmir Cab Quote 🚖\n\n{{1}}: ₹{{2}}/day ({{3}})"}'::jsonb,
    '{"seed":true,"name":"quote_single_v1"}'::jsonb
  ),
  (
    'driver_balance_v1', 'en_US', 'approved', 'UTILITY', null, '*',
    '{"body":"Your driver has been assigned 🚗"}'::jsonb,
    '{"seed":true,"name":"driver_balance_v1"}'::jsonb
  ),
  (
    'vendor_booking_notify_v1', 'en_US', 'approved', 'UTILITY', null, '*',
    '{"body":"New booking confirmed 🎉"}'::jsonb,
    '{"seed":true,"name":"vendor_booking_notify_v1"}'::jsonb
  ),
  (
    'customer_confirmation_v1', 'en_US', 'approved', 'UTILITY', null, '*',
    '{"body":"Your Cab Is Confirmed ✅"}'::jsonb,
    '{"seed":true,"name":"customer_confirmation_v1"}'::jsonb
  ),
  (
    'pre_pickup_reminder_v1', 'en_US', 'approved', 'UTILITY', null, '*',
    '{"body":"Reminder: your Kashmir cab pickup is tomorrow 🚗"}'::jsonb,
    '{"seed":true,"name":"pre_pickup_reminder_v1"}'::jsonb
  ),
  (
    'driver_assignment_v1', 'en_US', 'approved', 'UTILITY', null, '*',
    '{"body":"New ride assigned"}'::jsonb,
    '{"seed":true,"name":"driver_assignment_v1"}'::jsonb
  ),
  (
    'driver_contact_v1', 'en_US', 'approved', 'UTILITY', null, '*',
    '{"body":"Payment received ✅"}'::jsonb,
    '{"seed":true,"name":"driver_contact_v1"}'::jsonb
  )
on conflict (name, language, integrated_number) do nothing;
