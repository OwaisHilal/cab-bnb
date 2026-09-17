-- 0022: Replace the static Cashfree Payment Link workaround (0020/0021)
-- with Cashfree's PG Orders API (`POST /pg/orders`). PG Orders is a
-- different product from Payment Links — it is not gated by the
-- `link_creation_api is not enabled or approved` block that forced 0020's
-- fallback to a single dashboard-created static link — so every ₹99 token
-- payment goes back to being its own Cashfree order with its own
-- `payment_session_id`, restoring reliable per-booking payment
-- correlation. See docs/cashfree-payment-links-workaround.md and
-- docs/2026-09-14-static-cashfree-link-rollback.md for that history.
--
-- 0020/0021 are kept as-is (already applied). The `cf_link_id` column they
-- added stays in place as a harmless audit field for the retired flow;
-- `payment_link_url` is repurposed below to hold our own
-- `/pay/token/<crqid>` app payment page URL instead of a Cashfree URL.
-- Do not run itself — apply from the SQL editor or `db push`.

alter table public.whatsapp_payment_intents
  add column if not exists cf_order_id text,
  add column if not exists payment_session_id text,
  add column if not exists cf_payment_id text,
  add column if not exists cashfree_order_status text,
  add column if not exists cashfree_payment_status text,
  add column if not exists cashfree_bank_reference text,
  add column if not exists cashfree_order_expires_at timestamptz;

comment on column public.whatsapp_payment_intents.payment_link_url is
  'App-hosted payment page URL sent over WhatsApp (/pay/token/<crqid>), which opens Cashfree Checkout for this intent''s PG order. Prior to 0022 this held a Cashfree-hosted Payment Link URL directly.';

-- Idempotency: a Cashfree order/payment id should map to at most one
-- payment intent. Partial (where not null) so retried orders that
-- generate a fresh suffixed order_id (see lib/whatsapp/sendTokenPaymentLink.ts)
-- don't collide with an earlier expired attempt's now-orphaned row value.
create unique index if not exists whatsapp_payment_intents_cf_order_id_key
  on public.whatsapp_payment_intents (cf_order_id)
  where cf_order_id is not null;

create unique index if not exists whatsapp_payment_intents_cf_payment_id_key
  on public.whatsapp_payment_intents (cf_payment_id)
  where cf_payment_id is not null;

update public.whatsapp_message_templates
set
  notes = 'MSG91 session interactive type=cta_url, button "Pay 99" linking to our own /pay/token/<crqid> app payment page (app/pay/token/[crqid]/page.tsx), which opens Cashfree hosted Checkout for a per-booking Cashfree PG Order (lib/cashfree/orders.ts createCashfreeOrder, order_id = crqid on first attempt). Cart is one fixed ₹99 token; trip days and vendor overview stay in body text. Must be sent inside the 24h customer-care window. Confirmed via app/webhooks/cashfree (PAYMENT_SUCCESS_WEBHOOK matched back to whatsapp_payment_intents.cf_order_id), not MSG91''s On Payment Report Received. Restores the per-booking auto-confirmation that 0020/0021''s static-link workaround could not provide.',
  updated_at = now()
where template_key = 'token_lock_payment_v1';
