import "server-only"

import { isMsg91ErrorBody } from "@/lib/msg91/pure"
import {
  MSG91_WHATSAPP_GROUPS_URL,
  buildMsg91CreateGroupBody,
  buildMsg91GroupTextBody,
  parseMsg91GroupPayload,
  type ParsedMsg91Group,
} from "@/lib/msg91/groupApi"
import { resolveMsg91SendCredentials } from "@/lib/msg91/pure"

export interface Msg91GroupResult {
  configured: boolean
  success: boolean
  group?: ParsedMsg91Group
  error?: string
}

function groupsBaseUrl(): string {
  return process.env.MSG91_WHATSAPP_GROUPS_URL?.trim() || MSG91_WHATSAPP_GROUPS_URL
}

function readCredentials() {
  return resolveMsg91SendCredentials({
    MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
    MSG91_WHATSAPP_INTEGRATED_NUMBER: process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER,
  })
}

async function groupRequest(
  url: string,
  init: { method?: string; body?: string },
): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  const credentials = readCredentials()
  if (!credentials) {
    return { ok: false, status: 0, body: null, error: "MSG91 WhatsApp is not configured" }
  }

  const response = await fetch(url, {
    method: init.method ?? "POST",
    headers: {
      accept: "application/json",
      authkey: credentials.authKey,
      "content-type": "application/json",
    },
    body: init.body,
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok || isMsg91ErrorBody(body)) {
    return {
      ok: false,
      status: response.status,
      body,
      error: `MSG91 Groups API returned ${response.status}: ${JSON.stringify(body)}`,
    }
  }
  return { ok: true, status: response.status, body }
}

export async function createMsg91WhatsAppGroup(input: {
  subject: string
  description: string
}): Promise<Msg91GroupResult> {
  const credentials = readCredentials()
  if (!credentials) {
    return { configured: false, success: false, error: "MSG91 WhatsApp is not configured" }
  }

  const created = await groupRequest(groupsBaseUrl(), {
    body: JSON.stringify(
      buildMsg91CreateGroupBody({
        integratedNumber: credentials.integratedNumber,
        subject: input.subject,
        description: input.description,
      }),
    ),
  })
  if (!created.ok) {
    return { configured: true, success: false, error: created.error }
  }

  let parsed = parseMsg91GroupPayload(created.body)
  if (parsed.groupId && !parsed.inviteLink) {
    const confirmed = await getMsg91WhatsAppGroup(parsed.groupId)
    if (confirmed.success && confirmed.group) {
      parsed = {
        groupId: confirmed.group.groupId ?? parsed.groupId,
        inviteLink: confirmed.group.inviteLink ?? parsed.inviteLink,
        subject: confirmed.group.subject ?? parsed.subject,
      }
    }
  }

  if (!parsed.groupId || !parsed.inviteLink) {
    return {
      configured: true,
      success: false,
      group: parsed,
      error: "MSG91 created a group but did not return group_id and invite_link yet",
    }
  }

  return { configured: true, success: true, group: parsed }
}

export async function getMsg91WhatsAppGroup(groupId: string): Promise<Msg91GroupResult> {
  const credentials = readCredentials()
  if (!credentials) {
    return { configured: false, success: false, error: "MSG91 WhatsApp is not configured" }
  }

  const url = new URL(`${groupsBaseUrl()}/${encodeURIComponent(groupId)}`)
  url.searchParams.set("integrated_number", credentials.integratedNumber.replace(/^\+/, ""))

  const result = await groupRequest(url.toString(), { method: "GET" })
  if (!result.ok) {
    return { configured: true, success: false, error: result.error }
  }
  return { configured: true, success: true, group: parseMsg91GroupPayload(result.body) }
}

export async function sendMsg91GroupTextMessage(input: {
  groupId: string
  bodyText: string
}): Promise<{ configured: boolean; success: boolean; error?: string }> {
  const credentials = readCredentials()
  if (!credentials) {
    return { configured: false, success: false, error: "MSG91 WhatsApp is not configured" }
  }

  const result = await groupRequest(`${groupsBaseUrl()}/${encodeURIComponent(input.groupId)}/message`, {
    body: JSON.stringify(
      buildMsg91GroupTextBody({
        integratedNumber: credentials.integratedNumber,
        groupId: input.groupId,
        bodyText: input.bodyText,
      }),
    ),
  })
  if (!result.ok) {
    return { configured: true, success: false, error: result.error }
  }
  return { configured: true, success: true }
}

export async function deleteMsg91WhatsAppGroup(groupId: string): Promise<{
  configured: boolean
  success: boolean
  error?: string
}> {
  const credentials = readCredentials()
  if (!credentials) {
    return { configured: false, success: false, error: "MSG91 WhatsApp is not configured" }
  }

  const url = new URL(`${groupsBaseUrl()}/${encodeURIComponent(groupId)}`)
  url.searchParams.set("integrated_number", credentials.integratedNumber.replace(/^\+/, ""))
  const result = await groupRequest(url.toString(), { method: "DELETE" })
  if (!result.ok) {
    return { configured: true, success: false, error: result.error }
  }
  return { configured: true, success: true }
}
