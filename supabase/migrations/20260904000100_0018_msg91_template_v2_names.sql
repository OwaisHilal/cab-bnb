-- MSG91 rejected creating vendor_booking_notify_v1 and pre_pickup_reminder_v1
-- (Meta 4-week "English (US) content is being deleted" cooldown). Point the
-- catalog at v2 MSG91 names. Do not retarget MSG91_VENDOR_NOTIFY_* — that env
-- is the live vendor_assign_driver_v1 send path (9 body variables).

update public.whatsapp_message_templates
set
  msg91_template_name = 'vendor_booking_notify_v2',
  env_name_key = 'MSG91_VENDOR_BOOKING_NOTIFY_TEMPLATE_NAME',
  env_namespace_key = 'MSG91_VENDOR_BOOKING_NOTIFY_TEMPLATE_NAMESPACE',
  notes = 'Legacy vendor-notify copy. MSG91 name is vendor_booking_notify_v2 (v1 in Meta cooldown). Live assign uses vendor_assign_driver_v1 / MSG91_VENDOR_NOTIFY_*.',
  updated_at = now()
where template_key = 'vendor_booking_notify_v1';

update public.whatsapp_message_templates
set
  msg91_template_name = 'pre_pickup_reminder_v2',
  env_name_key = 'MSG91_PRE_PICKUP_TEMPLATE_NAME',
  env_namespace_key = 'MSG91_PRE_PICKUP_TEMPLATE_NAMESPACE',
  notes = 'MSG91 name is pre_pickup_reminder_v2 (v1 in Meta cooldown). Session text remains the in-window fallback.',
  updated_at = now()
where template_key = 'pre_pickup_reminder_v1';
