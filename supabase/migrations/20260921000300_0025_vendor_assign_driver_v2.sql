-- vendor_assign_driver_v1 (MSG91 name) gets a dynamic URL "Assign driver"
-- button and is recreated on MSG91 as vendor_assign_driver_v2 (UTILITY).
-- App template_key stays v1 (matches the quote_choice_v1 -> v2 precedent in
-- 20260904000200_0019_quote_templates_v2_utility.sql). v1 stays live/Green
-- with no button on MSG91 until v2 is approved — see
-- lib/whatsapp/notifyVendorBooking.ts and
-- docs/2026-09-21-vendor-assign-driver-v2-template.md.

update public.whatsapp_message_templates
set
  msg91_template_name = 'vendor_assign_driver_v2',
  buttons = '[{"type":"url","label":"Assign driver"}]'::jsonb,
  notes = 'MSG91 name is vendor_assign_driver_v2 (UTILITY, one dynamic URL button). v1 stays live/Green with no button until v2 is approved.',
  updated_at = now()
where template_key = 'vendor_assign_driver_v1';
