import type { SupabaseClient } from "@supabase/supabase-js"
import { canSendTemplate } from "./envelope"
import { newRequestId, newWamid } from "./ids"
import type { ParsedBulk, ParsedSession } from "./parseBody"
import { findSendableTemplate } from "./templates"
import { persistOutboundStatusTrail, persistWebhookEvent, buildInboundWebhookPayload } from "./webhooks"

export type SendBulkResult =
  | { ok: true; requestId: string; uuid: string }
  | { ok: false; message: string }

export async function sendBulk(
  supabase: SupabaseClient,
  parsed: ParsedBulk,
): Promise<SendBulkResult> {
  const template = await findSendableTemplate(
    supabase,
    parsed.templateName,
    parsed.languageCode,
    parsed.integratedNumber,
  )
  if (!template) {
    return { ok: false, message: `Template ${parsed.templateName} was not found` }
  }
  if (!canSendTemplate(template.template_status)) {
    return {
      ok: false,
      message: `Template ${parsed.templateName} is not approved (status: ${template.template_status})`,
    }
  }

  const requestId = newRequestId()
  const requestedAt = new Date().toISOString()
  let firstUuid: string | undefined

  for (const recipient of parsed.recipients) {
    for (const to of recipient.to) {
      const uuid = newWamid()
      firstUuid ??= uuid
      const { error } = await supabase.from("msg91_sim_messages").insert({
        request_id: requestId,
        uuid,
        direction: "outbound",
        content_type: "template",
        template_name: parsed.templateName,
        customer_number: to,
        integrated_number: parsed.integratedNumber,
        crqid: recipient.crqid ?? parsed.crqid ?? null,
        wa_status: "submitted",
        components: recipient.components,
        raw_request: parsed.raw,
      })
      if (error) {
        return { ok: false, message: error.message }
      }

      await persistOutboundStatusTrail(supabase, {
        customerNumber: to,
        integratedNumber: parsed.integratedNumber,
        requestId,
        uuid,
        templateName: parsed.templateName,
        crqid: recipient.crqid ?? parsed.crqid,
        content: recipient.components,
        requestedAt,
      })
    }
  }

  if (!firstUuid) {
    return { ok: false, message: "No recipients in to_and_components" }
  }
  return { ok: true, requestId, uuid: firstUuid }
}

export async function sendSession(
  supabase: SupabaseClient,
  parsed: ParsedSession,
): Promise<{ requestId: string; uuid: string }> {
  const requestId = newRequestId()
  const uuid = newWamid()
  const requestedAt = new Date().toISOString()
  const content =
    parsed.kind === "interactive"
      ? parsed.interactive
      : parsed.kind === "text"
        ? { text: parsed.text }
        : parsed.image

  const { error } = await supabase.from("msg91_sim_messages").insert({
    request_id: requestId,
    uuid,
    direction: "outbound",
    content_type: parsed.kind,
    template_name: null,
    customer_number: parsed.recipientNumber,
    integrated_number: parsed.integratedNumber,
    crqid: null,
    wa_status: "submitted",
    components: content,
    raw_request: parsed.raw,
  })
  if (error) {
    throw new Error(error.message)
  }

  await persistOutboundStatusTrail(supabase, {
    customerNumber: parsed.recipientNumber,
    integratedNumber: parsed.integratedNumber,
    requestId,
    uuid,
    content,
    requestedAt,
  })

  return { requestId, uuid }
}

export async function injectInbound(
  supabase: SupabaseClient,
  input: {
    customerNumber: string
    integratedNumber: string
    text?: string
    button?: { payload: string; text: string }
    contentType?: string
  },
): Promise<{ uuid: string; payload: Record<string, unknown> }> {
  const requestId = newRequestId()
  const uuid = newWamid()
  const ts = new Date().toISOString()
  const contentType = input.contentType ?? (input.button ? "interactive" : "text")
  const payload = buildInboundWebhookPayload({
    customerNumber: input.customerNumber,
    integratedNumber: input.integratedNumber,
    uuid,
    requestId,
    text: input.text,
    button: input.button,
    contentType,
    ts,
  })

  const { error } = await supabase.from("msg91_sim_messages").insert({
    request_id: requestId,
    uuid,
    direction: "inbound",
    content_type: contentType,
    template_name: null,
    customer_number: input.customerNumber,
    integrated_number: input.integratedNumber,
    crqid: null,
    wa_status: "replied",
    components: input.button ?? { text: input.text ?? "" },
    raw_request: payload,
  })
  if (error) {
    throw new Error(error.message)
  }

  await persistWebhookEvent(supabase, payload)
  return { uuid, payload }
}
