-- 0015: ₹99 token-lock WhatsApp Payments (Cashfree) via MSG91 payment_link.
-- Do not run itself — apply from the SQL editor or `db push`.

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
      'session_payment_link'
    )
  );

create table if not exists public.whatsapp_payment_intents (
  id uuid primary key default gen_random_uuid(),
  quote_snapshot_id uuid not null references public.quote_snapshots(id) on delete cascade,
  trip_request_id uuid not null references public.trip_requests(id) on delete cascade,
  tourist_id uuid references public.tourists(id),
  vendor_id uuid references public.vendors(id),
  customer_number text not null,
  amount_inr numeric(12,2) not null default 99,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'paid', 'failed', 'expired')),
  crqid text not null unique,
  wa_message_id text,
  paid_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_payment_intents_quote
  on public.whatsapp_payment_intents (quote_snapshot_id);

create index if not exists idx_whatsapp_payment_intents_customer_status
  on public.whatsapp_payment_intents (customer_number, status);

create unique index if not exists idx_whatsapp_payment_intents_open_quote
  on public.whatsapp_payment_intents (quote_snapshot_id)
  where status in ('pending', 'sent');

drop trigger if exists trg_whatsapp_payment_intents_updated_at on public.whatsapp_payment_intents;
create trigger trg_whatsapp_payment_intents_updated_at
  before update on public.whatsapp_payment_intents
  for each row execute function public.set_updated_at();

alter table public.whatsapp_payment_intents enable row level security;

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
) values (
  'token_lock_payment_v1',
  'token_lock_payment_v1',
  'SESSION',
  'session_payment_link',
  E'Lock this cab with a ₹99 token.\n\nTrip: {{trip_summary}}\n{{vendor_line}}\nTotal: {{trip_total}} · Token: ₹99 · Balance: {{balance_due}}\n\nDays\n{{day_lines}}',
  null,
  'Pay ₹99 to lock this cab.',
  '[]'::jsonb,
  null,
  '{"trip_summary":"days · pax · cab type · pickup → drop","vendor_line":"selected vendor ₹price/day (rating)","trip_total":"trip_days × price/day","balance_due":"trip total minus ₹99","day_lines":"Day N · dd Mon"}'::jsonb,
  null,
  null,
  false,
  'lib/whatsapp/sendTokenPaymentLink.ts',
  'Not a dashboard Utility template. MSG91 session interactive type=payment_link (Cashfree only). Cart is one ₹99 item; trip days and vendor overview are body text. Must be sent inside the 24h customer-care window. Correlate via CRQID = payment intent id. Enable On Payment Report Received on Webhook (New).'
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
