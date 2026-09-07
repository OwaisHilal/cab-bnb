-- 0017: ride WhatsApp groups (invite-link join, lifecycle, analytics events).
-- Create after fully_paid + ready_for_pickup. Do not apply until reviewed.

alter table public.whatsapp_message_templates
  drop constraint if exists whatsapp_message_templates_send_method_check;

alter table public.whatsapp_message_templates
  add constraint whatsapp_message_templates_send_method_check
  check (
    send_method in (
      'bulk_template',
      'session_list',
      'session_button',
      'session_text',
      'session_image',
      'session_payment_link',
      'session_cta_url'
    )
  );

-- ---------------------------------------------------------------------------
-- Ride group directory (service-role only; no anon listing)
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_ride_groups (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  msg91_group_id text not null,
  invite_link text not null,
  subject text not null,
  description text,
  join_approval_mode text not null default 'auto_approve'
    check (join_approval_mode in ('auto_approve', 'approval_required')),
  status text not null default 'created'
    check (status in ('created', 'invited', 'active', 'deleting', 'deleted', 'failed')),
  customer_joined_at timestamptz,
  driver_joined_at timestamptz,
  welcome_sent_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_whatsapp_ride_groups_open_booking
  on public.whatsapp_ride_groups (booking_id)
  where deleted_at is null;

create index if not exists idx_whatsapp_ride_groups_booking
  on public.whatsapp_ride_groups (booking_id);

create unique index if not exists idx_whatsapp_ride_groups_msg91
  on public.whatsapp_ride_groups (msg91_group_id);

drop trigger if exists trg_whatsapp_ride_groups_updated_at on public.whatsapp_ride_groups;
create trigger trg_whatsapp_ride_groups_updated_at
  before update on public.whatsapp_ride_groups
  for each row execute function public.set_updated_at();

alter table public.whatsapp_ride_groups enable row level security;

create table if not exists public.whatsapp_ride_group_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.whatsapp_ride_groups(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  participant_role text
    check (participant_role in ('customer', 'driver', 'business', 'unknown')),
  event_type text not null,
  wa_id text,
  wa_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_ride_group_events_group
  on public.whatsapp_ride_group_events (group_id, created_at desc);

create index if not exists idx_whatsapp_ride_group_events_booking
  on public.whatsapp_ride_group_events (booking_id, created_at desc);

create index if not exists idx_whatsapp_ride_group_events_type
  on public.whatsapp_ride_group_events (event_type, created_at desc);

alter table public.whatsapp_ride_group_events enable row level security;

-- ---------------------------------------------------------------------------
-- Catalog: UTILITY invite templates (CTA URL). Session CTA/text is the fallback.
-- ---------------------------------------------------------------------------
insert into public.whatsapp_message_templates (
  template_key,
  msg91_template_name,
  category,
  send_method,
  body_template,
  dashboard_body,
  footer_template,
  buttons,
  list_config,
  variable_schema,
  env_name_key,
  env_namespace_key,
  requires_dashboard_create,
  wired_in_code,
  notes
) values
(
  'ride_group_guest_v1',
  'ride_group_guest_v1',
  'UTILITY',
  'bulk_template',
  E'Your driver is connected.\n\nWe created a private WhatsApp group for this ride with your driver. Joining helps us quality-control the trip and keep an eye on communication.\n\nRide: {{booking_ref}}\nPickup: {{pickup_line}}',
  E'Your driver is connected.\n\nWe created a private WhatsApp group for this ride with your driver. Joining helps us quality-control the trip and keep an eye on communication.\n\nRide: {{1}}\nPickup: {{2}}',
  'Kashmir BnB Cabs',
  '[{"type":"url","label":"Join ride group"}]'::jsonb,
  null,
  '{"booking_ref":"BK-…","pickup_line":"place · date time"}'::jsonb,
  'MSG91_RIDE_GROUP_GUEST_TEMPLATE_NAME',
  'MSG91_RIDE_GROUP_GUEST_TEMPLATE_NAMESPACE',
  true,
  'lib/whatsapp/createRideGroup.ts',
  'Create Green on MSG91 with a CTA URL https://chat.whatsapp.com/{{1}}. Session CTA/text is the fallback. Users must tap Join — API cannot add them.'
),
(
  'ride_group_driver_v1',
  'ride_group_driver_v1',
  'UTILITY',
  'bulk_template',
  E'New ride assigned.\n\nPassenger: {{guest_name}}\nPickup: {{pickup_line}}\n\nWe created a WhatsApp group with the passenger for this ride. Joining helps us quality-control the trip and keep an eye on communication.',
  E'New ride assigned.\n\nPassenger: {{1}}\nPickup: {{2}}\n\nWe created a WhatsApp group with the passenger for this ride. Joining helps us quality-control the trip and keep an eye on communication.',
  'Kashmir BnB Cabs',
  '[{"type":"url","label":"Join ride group"}]'::jsonb,
  null,
  '{"guest_name":"","pickup_line":"place · date time"}'::jsonb,
  'MSG91_RIDE_GROUP_DRIVER_TEMPLATE_NAME',
  'MSG91_RIDE_GROUP_DRIVER_TEMPLATE_NAMESPACE',
  true,
  'lib/whatsapp/createRideGroup.ts',
  'Create Green on MSG91 with a CTA URL https://chat.whatsapp.com/{{1}}. Driver often has no 24h session, so the Utility template is required in production.'
)
on conflict (template_key) do update set
  msg91_template_name = excluded.msg91_template_name,
  category = excluded.category,
  send_method = excluded.send_method,
  body_template = excluded.body_template,
  dashboard_body = excluded.dashboard_body,
  footer_template = excluded.footer_template,
  buttons = excluded.buttons,
  list_config = excluded.list_config,
  variable_schema = excluded.variable_schema,
  env_name_key = excluded.env_name_key,
  env_namespace_key = excluded.env_namespace_key,
  requires_dashboard_create = excluded.requires_dashboard_create,
  wired_in_code = excluded.wired_in_code,
  notes = excluded.notes,
  active = true,
  updated_at = now();
