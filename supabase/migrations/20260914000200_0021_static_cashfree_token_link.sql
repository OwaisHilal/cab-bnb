-- 0021: Correct 0020's metadata now that Cashfree's dynamic Payment Links
-- create-API has also turned out to be blocked on this merchant account
-- (`link_creation_api is not enabled or approved` — a separate gate from
-- the `s2s_enabled_not_approved` block on MSG91's `payment_link` type that
-- 0020 was written to work around). We now send one dashboard-created
-- static Cashfree link for every ₹99 token payment instead of creating one
-- per booking. See docs/cashfree-payment-links-workaround.md.
--
-- 0020 is kept as-is (already applied) — this migration only corrects the
-- template notes so they describe the current architecture. The `cf_link_id`
-- and `payment_link_url` columns it added stay in place as harmless audit
-- fields; `send_method = 'session_cta_url'` is unchanged (still a WhatsApp
-- CTA-URL button, just pointing at a shared link instead of a per-booking
-- one).
-- Do not run itself — apply from the SQL editor or `db push`.

update public.whatsapp_message_templates
set
  notes = 'MSG91 session interactive type=cta_url, button "Pay 99" linking to the dashboard-created static Cashfree link https://payments.cashfree.com/links/Cb0o4hnupupg_AAAAAAAVUJE (see lib/whatsapp/tokenPaymentLink.ts STATIC_TOKEN_PAYMENT_LINK_URL). Cashfree''s dynamic Payment Links create-API (link_creation_api) is not enabled/approved on this merchant account, same as the pre-existing s2s_enabled_not_approved block on MSG91''s payment_link interactive type — both automated per-booking paths are blocked. Cart is one fixed ₹99 token; trip days and vendor overview stay in body text. Must be sent inside the 24h customer-care window. app/api/cashfree/webhook logs PAYMENT_LINK_EVENT for this shared link as an audit trail only (cannot auto-confirm a specific booking); payment confirmation is manual until a per-booking correlation mechanism exists again.',
  updated_at = now()
where template_key = 'token_lock_payment_v1';
