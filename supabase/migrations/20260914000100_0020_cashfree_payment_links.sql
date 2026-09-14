-- 0020: Cashfree Payment Links workaround for the ₹99 token payment.
-- MSG91's session `payment_link` interactive type (Cashfree Orders/S2S API)
-- is blocked on this merchant account (s2s_enabled_not_approved). We now
-- create a Cashfree Payment Link directly and send it as a plain WhatsApp
-- CTA-URL button instead — see docs/cashfree-payment-links-workaround.md.
-- Do not run itself — apply from the SQL editor or `db push`.

-- Audit columns only: correlation still uses the existing `crqid` column
-- (already the intent id, now also passed to Cashfree as `link_id`).
alter table public.whatsapp_payment_intents
  add column if not exists cf_link_id text,
  add column if not exists payment_link_url text;

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

update public.whatsapp_message_templates
set
  send_method = 'session_cta_url',
  notes = 'MSG91 session interactive type=cta_url, button "Pay 99" linking to a Cashfree Payment Link created directly via lib/cashfree/client.ts (Cashfree Orders/S2S "payment_link" API is blocked by s2s_enabled_not_approved on this merchant account). Cart is one fixed ₹99 token; trip days and vendor overview stay in body text. Must be sent inside the 24h customer-care window. Correlate via CRQID = payment intent id = Cashfree link_id. Confirmed via app/api/cashfree/webhook (PAYMENT_LINK_EVENT), not MSG91''s On Payment Report Received.',
  updated_at = now()
where template_key = 'token_lock_payment_v1';
