import type { SupabaseClient } from "@supabase/supabase-js"
import { stripPhone } from "./ids"
import type { ExtractedTemplateFields } from "./parseBody"
import { isTemplateStatus, type TemplateStatus } from "./envelope"

export type SimTemplateRow = {
  id: string
  name: string
  language: string
  template_status: string
  category: string | null
  namespace: string | null
  integrated_number: string
  components: Record<string, unknown>
  raw_request: Record<string, unknown>
  created_at: string
  updated_at: string
}

export function toPublicTemplate(row: SimTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    template_name: row.name,
    language: row.language,
    template_language: row.language,
    status: row.template_status,
    template_status: row.template_status,
    category: row.category,
    namespace: row.namespace,
    integrated_number: row.integrated_number,
    components: row.components,
  }
}

const SEED_TEMPLATES: Array<{
  name: string
  category: string
  body: string
}> = [
  {
    name: "otp_verification",
    category: "AUTHENTICATION",
    body: "Your Kashmir BnB Cabs verification code is {{1}}. Do not share this code with anyone.",
  },
  {
    name: "quote_single_v1",
    category: "UTILITY",
    body: "Your Kashmir Cab Quote",
  },
  {
    name: "quote_choice_v1",
    category: "UTILITY",
    body: "Your Kashmir cab quotes are in.",
  },
  {
    name: "driver_balance_v1",
    category: "UTILITY",
    body: "Your driver has been assigned",
  },
  {
    name: "vendor_booking_notify_v1",
    category: "UTILITY",
    body: "New booking confirmed",
  },
  {
    name: "customer_confirmation_v1",
    category: "UTILITY",
    body: "Your Cab Is Confirmed",
  },
  {
    name: "pre_pickup_reminder_v1",
    category: "UTILITY",
    body: "Reminder: your Kashmir cab pickup is tomorrow",
  },
  {
    name: "driver_assignment_v1",
    category: "UTILITY",
    body: "New ride assigned",
  },
  {
    name: "driver_contact_v1",
    category: "UTILITY",
    body: "Payment received",
  },
]

export async function ensureSeededTemplates(supabase: SupabaseClient): Promise<void> {
  const { count, error } = await supabase
    .from("msg91_sim_templates")
    .select("id", { count: "exact", head: true })
  if (error) {
    throw new Error(error.message)
  }
  if ((count ?? 0) > 0) {
    return
  }

  const { error: insertError } = await supabase.from("msg91_sim_templates").insert(
    SEED_TEMPLATES.map((template) => ({
      name: template.name,
      language: "en_US",
      template_status: "approved",
      category: template.category,
      integrated_number: "*",
      components: { body: template.body },
      raw_request: { seed: true, name: template.name },
    })),
  )
  if (insertError && !insertError.message.includes("duplicate")) {
    throw new Error(insertError.message)
  }
}

export async function createTemplate(
  supabase: SupabaseClient,
  fields: ExtractedTemplateFields,
  raw: Record<string, unknown>,
): Promise<SimTemplateRow> {
  if (!fields.name) {
    throw new Error("template name is required")
  }

  const { data, error } = await supabase
    .from("msg91_sim_templates")
    .insert({
      name: fields.name,
      language: fields.language ?? "en_US",
      template_status: "pending",
      category: fields.category ?? null,
      namespace: fields.namespace ?? null,
      integrated_number: fields.integratedNumber ? stripPhone(fields.integratedNumber) : "*",
      components: fields.components,
      raw_request: raw,
    })
    .select("*")
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create template")
  }
  return data as SimTemplateRow
}

export async function updateTemplate(
  supabase: SupabaseClient,
  templateId: string,
  fields: ExtractedTemplateFields,
  raw: Record<string, unknown>,
): Promise<SimTemplateRow | null> {
  const patch: Record<string, unknown> = { raw_request: raw }
  if (fields.name) patch.name = fields.name
  if (fields.language) patch.language = fields.language
  if (fields.category) patch.category = fields.category
  if (fields.namespace) patch.namespace = fields.namespace
  if (fields.integratedNumber) patch.integrated_number = stripPhone(fields.integratedNumber)
  if (Object.keys(fields.components).length > 0) patch.components = fields.components

  const { data, error } = await supabase
    .from("msg91_sim_templates")
    .update(patch)
    .eq("id", templateId)
    .select("*")
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }
  return (data as SimTemplateRow | null) ?? null
}

export async function deleteTemplateByName(
  supabase: SupabaseClient,
  templateName: string,
  integratedNumber: string,
): Promise<number> {
  const number = stripPhone(integratedNumber)
  const { data, error } = await supabase
    .from("msg91_sim_templates")
    .delete()
    .eq("name", templateName)
    .eq("integrated_number", number)
    .select("id")

  if (error) {
    throw new Error(error.message)
  }
  return data?.length ?? 0
}

export type ListTemplateFilters = {
  number: string
  templateName?: string
  templateStatus?: string
  templateLanguage?: string
  pagination?: string
  pageSize?: number
  pageNum?: number
}

export async function listTemplates(
  supabase: SupabaseClient,
  filters: ListTemplateFilters,
): Promise<{
  rows: ReturnType<typeof toPublicTemplate>[]
  total: number
  paginated: boolean
  hasMoreData: boolean
}> {
  await ensureSeededTemplates(supabase)

  const number = stripPhone(filters.number).replace(/[^\d]/g, "")
  let query = supabase
    .from("msg91_sim_templates")
    .select("*", { count: "exact" })
    .or(`integrated_number.eq.${number},integrated_number.eq.*`)
    .order("created_at", { ascending: false })
    .limit(500)

  if (filters.templateName) {
    query = query.ilike("name", `%${filters.templateName}%`)
  }
  if (filters.templateStatus) {
    query = query.eq("template_status", filters.templateStatus.toLowerCase())
  }
  if (filters.templateLanguage) {
    query = query.eq("language", filters.templateLanguage)
  }

  const { data, error, count } = await query
  if (error) {
    throw new Error(error.message)
  }

  const all = ((data ?? []) as SimTemplateRow[]).map(toPublicTemplate)
  const total = count ?? all.length
  const paginated = Boolean(filters.pagination && filters.pagination.length > 0)
  if (!paginated) {
    return { rows: all.slice(0, 500), total, paginated: false, hasMoreData: false }
  }

  const page = paginateTemplateRows(all, filters.pageSize ?? 20, filters.pageNum ?? 1)
  return { rows: page.rows, total, paginated: true, hasMoreData: page.hasMoreData }
}

export function paginateTemplateRows<T>(
  rows: T[],
  pageSize: number,
  pageNum: number,
): { rows: T[]; hasMoreData: boolean } {
  const size = Math.min(Math.max(pageSize, 1), 500)
  const page = Math.max(pageNum, 1)
  const start = (page - 1) * size
  const slice = rows.slice(start, start + size)
  return {
    rows: slice,
    hasMoreData: start + slice.length < rows.length,
  }
}

export async function findSendableTemplate(
  supabase: SupabaseClient,
  name: string,
  languageCode: string,
  integratedNumber: string,
): Promise<SimTemplateRow | null> {
  await ensureSeededTemplates(supabase)
  const number = stripPhone(integratedNumber)
  const { data, error } = await supabase
    .from("msg91_sim_templates")
    .select("*")
    .eq("name", name)
    .eq("language", languageCode)
    .or(`integrated_number.eq.${number},integrated_number.eq.*`)
    .limit(1)

  if (error) {
    throw new Error(error.message)
  }
  const row = (data?.[0] as SimTemplateRow | undefined) ?? null
  return row
}

export async function setTemplateStatus(
  supabase: SupabaseClient,
  input: { id?: string; name?: string; templateStatus: TemplateStatus },
): Promise<SimTemplateRow | null> {
  if (!isTemplateStatus(input.templateStatus)) {
    throw new Error("template_status must be pending, approved, or rejected")
  }

  let query = supabase
    .from("msg91_sim_templates")
    .update({ template_status: input.templateStatus })
    .select("*")

  if (input.id) {
    query = query.eq("id", input.id)
  } else if (input.name) {
    query = query.eq("name", input.name)
  } else {
    throw new Error("id or name is required")
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }
  const rows = (data ?? []) as SimTemplateRow[]
  return rows[0] ?? null
}
