-- quote_choice_v1 / quote_single_v1 were submitted as UTILITY, recategorized
-- MARKETING by Meta, then deleted. Recreate on MSG91 as quote_*_v2 (UTILITY,
-- allow_category_change=false). App template_key stays v1.

update public.whatsapp_message_templates
set
  msg91_template_name = 'quote_choice_v2',
  notes = 'MSG91 name is quote_choice_v2 (UTILITY). v1 was recategorized MARKETING and deleted.',
  updated_at = now()
where template_key = 'quote_choice_v1';

update public.whatsapp_message_templates
set
  msg91_template_name = 'quote_single_v2',
  notes = 'MSG91 name is quote_single_v2 (UTILITY). v1 was recategorized MARKETING and deleted.',
  updated_at = now()
where template_key = 'quote_single_v1';
