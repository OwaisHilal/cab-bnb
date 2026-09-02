import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { asRecord, newRequestId, newWamid, readString, stripPhone } from "@/lib/msg91-sim/ids"
import {
  buildInboundWebhookPayload,
  buildOutboundWebhookPayload,
} from "@/lib/msg91-sim/webhookPayload"
import { persistWebhookEvent } from "@/lib/msg91-sim/webhooks"
import { parseInboundAction } from "@/lib/whatsapp/webhook/parseInboundAction"
import { parseMsg91Webhook } from "@/lib/whatsapp/webhook/parseMsg91Webhook"
import {
  MSG91_WEBHOOK_SECRET_HEADER,
  getMsg91WebhookSecret,
} from "@/lib/whatsapp/webhook/verifyMsg91Webhook"

const DEFAULT_INTEGRATED = () =>
  process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim() || "919999988888"

/**
 * Builds an MSG91 Webhook (New) payload and POSTs it to
 * `/api/whatsapp/webhook` — the same path live MSG91 will call.
 *
 * Auth: `authkey` (simulator). The forwarded request uses
 * `x-msg91-webhook-secret`.
 */
export async function POST(request: NextRequest) {
  return withMsg91Sim(request, async (supabase) => {
    const body = await readOptionalJson(request)
    const raw = asRecord(body)
    if (!raw) {
      return jsonMsg91(bulkFail("Request body must be a JSON object"), 400)
    }

    const webhookSecret = getMsg91WebhookSecret()
    if (!webhookSecret) {
      return jsonMsg91(
        bulkFail("MSG91_WEBHOOK_SECRET is required so the simulator can call /api/whatsapp/webhook"),
        500,
      )
    }

    const kind = (readString(raw, ["kind", "event"]) ?? "button").toLowerCase()
    const payload = buildSimulatedPayload(raw, kind)
    if (!payload.ok) {
      return jsonMsg91(bulkFail(payload.message), 400)
    }

    await persistWebhookEvent(supabase, payload.body)

    const parsed = parseMsg91Webhook(payload.body)
    const parsedAction = parsed.messages[0] ? parseInboundAction(parsed.messages[0]) : null

    const webhookUrl = new URL("/api/whatsapp/webhook", request.nextUrl.origin).toString()
    let webhookStatus = 0
    let webhookBody: unknown = null
    try {
      const forwarded = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [MSG91_WEBHOOK_SECRET_HEADER]: webhookSecret,
        },
        body: JSON.stringify(payload.body),
      })
      webhookStatus = forwarded.status
      webhookBody = await readResponseBody(forwarded)
    } catch (error) {
      return jsonMsg91(
        bulkFail(error instanceof Error ? error.message : "Failed to POST /api/whatsapp/webhook"),
        502,
      )
    }

    return jsonMsg91(
      bulkOk({
        forwarded: true,
        webhookUrl,
        webhookStatus,
        webhookBody,
        payload: payload.body,
        parsedAction,
        messages: parsed.messages,
        statuses: parsed.statuses,
      }),
    )
  })
}

function buildSimulatedPayload(
  raw: Record<string, unknown>,
  kind: string,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  if (kind === "raw") {
    const nested = asRecord(raw.payload)
    if (!nested) {
      return { ok: false, message: "kind=raw requires payload as a JSON object" }
    }
    return { ok: true, body: nested }
  }

  const customerNumber = readString(raw, ["customerNumber", "customer_number", "from"])
  if (!customerNumber) {
    return { ok: false, message: "customerNumber is required" }
  }

  const integratedNumber =
    readString(raw, ["integratedNumber", "integrated_number", "to"]) ?? DEFAULT_INTEGRATED()
  const ts = new Date().toISOString()
  const uuid = readString(raw, ["uuid", "waMessageId", "wa_message_id"]) ?? newWamid()
  const requestId = readString(raw, ["requestId", "request_id"]) ?? newRequestId()

  if (kind === "read" || kind === "delivered" || kind === "sent" || kind === "failed") {
    return {
      ok: true,
      body: buildOutboundWebhookPayload({
        eventName: kind,
        customerNumber: stripPhone(customerNumber),
        integratedNumber: stripPhone(integratedNumber),
        requestId,
        uuid,
        templateName: readString(raw, ["templateName", "template_name"]),
        content: {},
        requestedAt: ts,
        ts,
      }),
    }
  }

  if (kind === "text") {
    const text = readString(raw, ["text"])
    if (!text) {
      return { ok: false, message: "kind=text requires text" }
    }
    return {
      ok: true,
      body: buildInboundWebhookPayload({
        customerNumber: stripPhone(customerNumber),
        integratedNumber: stripPhone(integratedNumber),
        uuid,
        requestId,
        text,
        contentType: "text",
        ts,
      }),
    }
  }

  const buttonPayload =
    readString(raw, ["buttonPayload", "button_payload", "payload"]) ??
    readString(asRecord(raw.button) ?? {}, ["payload"])
  const buttonText =
    readString(raw, ["buttonText", "button_text"]) ??
    readString(asRecord(raw.button) ?? {}, ["text"]) ??
    buttonPayload
  if (!buttonPayload) {
    return {
      ok: false,
      message: "kind=button requires buttonPayload (e.g. BOOK_TOKEN::<quote_snapshot_id>)",
    }
  }

  return {
    ok: true,
    body: buildInboundWebhookPayload({
      customerNumber: stripPhone(customerNumber),
      integratedNumber: stripPhone(integratedNumber),
      uuid,
      requestId,
      button: { payload: buttonPayload, text: buttonText ?? buttonPayload },
      contentType: "interactive",
      ts,
    }),
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}
