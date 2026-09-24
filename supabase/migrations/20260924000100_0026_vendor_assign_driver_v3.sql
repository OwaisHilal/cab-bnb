-- vendor_assign_driver_v3 approved on MSG91 2026-09-24 (template_id
-- 2949504098758945). Same 9 body variables and one dynamic "Assign driver"
-- URL button as v2 — only the trailing CTA sentence changes, dropping the
-- long "Optional: DRIVER: <name> | <phone> | ..." line in favor of a
-- shorter instruction that also mentions the button. Internal template_key
-- stays vendor_assign_driver_v1 (same pattern as the v1 -> v2 switch in
-- 20260921000300_0025_vendor_assign_driver_v2.sql). v2 remains on MSG91 but
-- is no longer sent to. See docs/2026-09-24-vendor-assign-driver-v3-template.md.

update public.whatsapp_message_templates
set
  msg91_template_name = 'vendor_assign_driver_v3',
  body_template = 'New booking confirmed.

Guest: {{guest_name}}
Route: {{pickup}} → {{drop}}
Date: {{pickup_date}}, {{trip_days}} {{day_label}}
Pax: {{pax_count}} | Cab: {{vehicle_label}}
Total: {{trip_total}}

Reply with the driver''s 10-digit mobile number, or tap Assign driver below.',
  notes = 'MSG91 name is vendor_assign_driver_v3 (UTILITY, same 9 body variables + one dynamic URL button as v2, simplified CTA copy, approved 2026-09-24).',
  updated_at = now()
where template_key = 'vendor_assign_driver_v1';
