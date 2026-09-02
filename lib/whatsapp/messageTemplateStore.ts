import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { WhatsAppListMessage } from "@/lib/whatsapp/types"
import { formatInr } from "@/lib/whatsapp/formatInr"

export type MessageTemplateSendMethod =
  | "bulk_template"
  | "session_list"
  | "session_button"
  | "session_text"
  | "session_image"

export interface MessageTemplateButtonSpec {
  type?: string
  label?: string
  title?: string
  payloadPrefix?: string
}

export interface MessageTemplateListConfig {
  buttonText?: string
  sectionTitle?: string
  rowIdPrefix?: string
}

export interface WhatsAppMessageTemplateRow {
  template_key: string
  msg91_template_name: string
  category: string
  send_method: MessageTemplateSendMethod
  language_code: string
  body_template: string
  dashboard_body: string | null
  header_template: string | null
  footer_template: string | null
  buttons: MessageTemplateButtonSpec[]
  list_config: MessageTemplateListConfig | null
  variable_schema: Record<string, string>
  env_name_key: string | null
  env_namespace_key: string | null
  requires_dashboard_create: boolean
  wired_in_code: string | null
  notes: string | null
  active: boolean
}

let templateCache: Map<string, WhatsAppMessageTemplateRow> | null = null

/** Inline fallbacks when migration not applied yet. */
const FALLBACK_TEMPLATES: WhatsAppMessageTemplateRow[] = [
  {
    template_key: "quote_single_v1",
    msg91_template_name: "quote_single_v1",
    category: "UTILITY",
    send_method: "session_list",
    language_code: "en_US",
    body_template: "Your Kashmir Cab Quote 🚖\n\n{{vendor_name}}: {{price_per_day}}/day ({{vehicle_label}})",
    dashboard_body: null,
    header_template: null,
    footer_template: null,
    buttons: [],
    list_config: { buttonText: "Choose operator", sectionTitle: "Pay ₹99 to lock", rowIdPrefix: "BOOK_TOKEN::" },
    variable_schema: {},
    env_name_key: null,
    env_namespace_key: null,
    requires_dashboard_create: true,
    wired_in_code: null,
    notes: null,
    active: true,
  },
  {
    template_key: "quote_multi_v1",
    msg91_template_name: "quote_multi_v1",
    category: "UTILITY",
    send_method: "session_list",
    language_code: "en_US",
    body_template: "Your Kashmir Cab Quotes Are In 🚖\n\n{{quote_lines}}",
    dashboard_body: null,
    header_template: null,
    footer_template: null,
    buttons: [],
    list_config: { buttonText: "Choose operator", sectionTitle: "Pay ₹99 to lock", rowIdPrefix: "BOOK_TOKEN::" },
    variable_schema: {},
    env_name_key: null,
    env_namespace_key: null,
    requires_dashboard_create: true,
    wired_in_code: null,
    notes: null,
    active: true,
  },
  {
    template_key: "driver_balance_v1",
    msg91_template_name: "driver_balance_v1",
    category: "UTILITY",
    send_method: "session_button",
    language_code: "en_US",
    body_template:
      "Your driver has been assigned 🚗\nOperator: {{vendor_name}}\n\nBalance due: {{balance_due}} (after ₹99 token).\nComplete payment here to unlock your driver's contact number.",
    dashboard_body: null,
    header_template: null,
    footer_template: null,
    buttons: [],
    list_config: null,
    variable_schema: {},
    env_name_key: null,
    env_namespace_key: null,
    requires_dashboard_create: true,
    wired_in_code: null,
    notes: null,
    active: true,
  },
  {
    template_key: "driver_contact_v1",
    msg91_template_name: "driver_contact_v1",
    category: "UTILITY",
    send_method: "session_text",
    language_code: "en_US",
    body_template:
      "Payment received ✅\nYour driver: {{driver_name}}\nCall / WhatsApp: {{driver_phone}}\nVehicle: {{vehicle_model}} ({{vehicle_number}})\nOperator: {{vendor_name}}\nDriver will reach out before pickup. Safe travels!",
    dashboard_body: null,
    header_template: null,
    footer_template: null,
    buttons: [],
    list_config: null,
    variable_schema: {},
    env_name_key: null,
    env_namespace_key: null,
    requires_dashboard_create: true,
    wired_in_code: null,
    notes: null,
    active: true,
  },
  {
    template_key: "driver_assignment_v1",
    msg91_template_name: "driver_assignment_v1",
    category: "UTILITY",
    send_method: "session_text",
    language_code: "en_US",
    body_template:
      "New ride assigned, {{driver_name}} 🚗\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nGuest: {{guest_name}} ({{guest_phone}})\nYour vehicle: {{vehicle_model}} ({{vehicle_number}})\nPlease contact the guest before pickup. Safe drive!",
    dashboard_body: null,
    header_template: null,
    footer_template: null,
    buttons: [],
    list_config: null,
    variable_schema: {},
    env_name_key: null,
    env_namespace_key: null,
    requires_dashboard_create: true,
    wired_in_code: null,
    notes: null,
    active: true,
  },
  {
    template_key: "vendor_booking_notify_v1",
    msg91_template_name: "vendor_booking_notify_v1",
    category: "UTILITY",
    send_method: "session_text",
    language_code: "en_US",
    body_template:
      "New booking confirmed 🎉\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nPax: {{pax_count}} | Vehicle: {{vehicle_label}}\nPrice: {{final_quote}}/day\n\nReply in this format to assign driver:\nDRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>\n\nExample:\nDRIVER: Bilal Ahmed | 9876543210 | JK01AB1234 | Swift Dzire",
    dashboard_body: null,
    header_template: null,
    footer_template: null,
    buttons: [],
    list_config: null,
    variable_schema: {},
    env_name_key: null,
    env_namespace_key: null,
    requires_dashboard_create: true,
    wired_in_code: null,
    notes: null,
    active: true,
  },
  {
    template_key: "vendor_booking_notify_demo",
    msg91_template_name: "vendor_booking_notify_v1",
    category: "UTILITY",
    send_method: "session_text",
    language_code: "en_US",
    body_template:
      "New booking confirmed for {{vendor_name}} 🎉\nGuest: {{guest_name}} ({{guest_phone}})\nRoute: {{pickup}} → {{drop}}\nDate: {{pickup_date}}, {{trip_days}} {{day_label}}\nPax: {{pax_count}} | Vehicle: {{vehicle_label}}\nAgreed quote: {{final_quote}}/day\n\nReply in this format to assign driver:\nDRIVER: <name> | <phone> | <vehicle_number> | <vehicle_model>",
    dashboard_body: null,
    header_template: null,
    footer_template: null,
    buttons: [],
    list_config: null,
    variable_schema: {},
    env_name_key: null,
    env_namespace_key: null,
    requires_dashboard_create: false,
    wired_in_code: null,
    notes: null,
    active: true,
  },
]

function parseRow(raw: Record<string, unknown>): WhatsAppMessageTemplateRow {
  return {
    template_key: String(raw.template_key),
    msg91_template_name: String(raw.msg91_template_name),
    category: String(raw.category),
    send_method: raw.send_method as MessageTemplateSendMethod,
    language_code: String(raw.language_code ?? "en_US"),
    body_template: String(raw.body_template),
    dashboard_body: (raw.dashboard_body as string | null) ?? null,
    header_template: (raw.header_template as string | null) ?? null,
    footer_template: (raw.footer_template as string | null) ?? null,
    buttons: Array.isArray(raw.buttons) ? (raw.buttons as MessageTemplateButtonSpec[]) : [],
    list_config: (raw.list_config as MessageTemplateListConfig | null) ?? null,
    variable_schema: (raw.variable_schema as Record<string, string>) ?? {},
    env_name_key: (raw.env_name_key as string | null) ?? null,
    env_namespace_key: (raw.env_namespace_key as string | null) ?? null,
    requires_dashboard_create: Boolean(raw.requires_dashboard_create),
    wired_in_code: (raw.wired_in_code as string | null) ?? null,
    notes: (raw.notes as string | null) ?? null,
    active: Boolean(raw.active),
  }
}

export function renderMessageTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = variables[key]
    if (value === null || value === undefined) return ""
    return String(value)
  })
}

export async function ensureMessageTemplates(supabase: SupabaseClient): Promise<Map<string, WhatsAppMessageTemplateRow>> {
  const { data, error } = await supabase
    .from("whatsapp_message_templates")
    .select("*")
    .eq("active", true)

  if (error) {
    console.warn("[message templates] DB load failed, using fallbacks:", error.message)
    templateCache = new Map(FALLBACK_TEMPLATES.map((row) => [row.template_key, row]))
    return templateCache
  }

  if (!data || data.length === 0) {
    templateCache = new Map(FALLBACK_TEMPLATES.map((row) => [row.template_key, row]))
    return templateCache
  }

  templateCache = new Map(
    data.map((row) => parseRow(row as Record<string, unknown>)).map((row) => [row.template_key, row]),
  )
  return templateCache
}

export function getMessageTemplate(templateKey: string): WhatsAppMessageTemplateRow | null {
  if (templateCache?.has(templateKey)) {
    return templateCache.get(templateKey) ?? null
  }
  return FALLBACK_TEMPLATES.find((row) => row.template_key === templateKey) ?? null
}

export function buildListConfigFromTemplate(
  template: WhatsAppMessageTemplateRow,
  rows: Array<{ id: string; title: string; description: string }>,
): WhatsAppListMessage {
  const config = template.list_config ?? {}
  return {
    buttonText: config.buttonText ?? "Choose operator",
    sections: [
      {
        title: config.sectionTitle ?? "Pay ₹99 to lock",
        rows,
      },
    ],
  }
}

export function formatPricePerDayInr(amount: number): string {
  return `${formatInr(amount)}/day`
}

export function invalidateMessageTemplateCache(): void {
  templateCache = null
}

export async function listMessageTemplates(
  supabase: SupabaseClient,
): Promise<WhatsAppMessageTemplateRow[]> {
  const map = await ensureMessageTemplates(supabase)
  return [...map.values()].sort((a, b) => a.template_key.localeCompare(b.template_key))
}
