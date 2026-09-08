import type { NextRequest } from "next/server"
import { bulkFail, bulkOk } from "@/lib/msg91-sim/envelope"
import { jsonMsg91, readOptionalJson, withMsg91Sim } from "@/lib/msg91-sim/http"
import { asRecord, newRequestId, newWamid, readString, stripPhone } from "@/lib/msg91-sim/ids"
import {
  buildInboundWebhookPayload,
  buildOutboundWebhookPayload,
  buildPaymentWebhookPayload,
} from "@/lib/msg91-sim/webhookPayload"
import { persistWebhookEvent } from "@/lib/msg91-sim/webhooks"
import { fillSimulatedButtonPayload } from "@/lib/msg91-sim/fillSimulatedButtonPayload"
import { processDueJobs } from "@/lib/jobs/processDueJobs"
import { parseInboundAction } from "@/lib/whatsapp/webhook/parseInboundAction"
import { parseMsg91Webhook } from "@/lib/whatsapp/webhook/parseMsg91Webhook"
import { resolveSelectVendorTap } from "@/lib/whatsapp/webhook/resolveSelectVendorTap"
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
    const resolvedQuoteSnapshotId =
      kind === "button" ? await resolveSimulatedSelectSnapshot(supabase, raw) : null
    const payload = buildSimulatedPayload(raw, kind, resolvedQuoteSnapshotId)
    if (!payload.ok) {
      return jsonMsg91(bulkFail(payload.message), 400)
    }

    await persistWebhookEvent(supabase, payload.body)

    const parsed = parseMsg91Webhook(payload.body)
    let parsedAction = parsed.messages[0] ? parseInboundAction(parsed.messages[0]) : null
    if (parsedAction?.type === "unknown" && parsed.messages[0]) {
      parsedAction = (await resolveSelectVendorTap(supabase, parsed.messages[0])) ?? parsedAction
    }

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

    const shouldProcessJobs =
      parsedAction?.type === "book_token" ||
      parsedAction?.type === "token_pay" ||
      parsed.payments.some((payment) => payment.paid) ||
      kind === "button"

    let jobs: { claimed: number; succeeded: number; failed: number } | null = null
    if (webhookStatus < 400 && shouldProcessJobs) {
      try {
        jobs = await processDueJobs(supabase)
      } catch (error) {
        jobs = { claimed: 0, succeeded: 0, failed: 0 }
        console.error("[msg91 simulate] processDueJobs failed", error)
      }
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
        payments: parsed.payments,
        jobs,
      }),
    )
  })
}

function buildSimulatedPayload(
  raw: Record<string, unknown>,
  kind: string,
  resolvedQuoteSnapshotId: string | null = null,
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

  if (kind === "payment") {
    const crqid = readString(raw, ["crqid", "CRQID"])
    if (!crqid) {
      return { ok: false, message: "kind=payment requires crqid (payment intent id or quote_snapshot_id)" }
    }
    const paymentStatus = readString(raw, ["paymentStatus", "payment_status"]) ?? "paid"
    return {
      ok: true,
      body: buildPaymentWebhookPayload({
        customerNumber: stripPhone(customerNumber),
        integratedNumber: stripPhone(integratedNumber),
        uuid,
        requestId,
        crqid,
        paymentStatus,
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
  const filled = fillSimulatedButtonPayload({
    buttonPayload,
    buttonText,
    resolvedQuoteSnapshotId,
  })
  if (filled.payload) {
    return {
      ok: true,
      body: buildInboundWebhookPayload({
        customerNumber: stripPhone(customerNumber),
        integratedNumber: stripPhone(integratedNumber),
        uuid,
        requestId,
        button: { payload: filled.payload, text: filled.text ?? filled.payload },
        contentType: "interactive",
        ts,
      }),
    }
  }
  if (filled.text) {
    return {
      ok: true,
      body: buildInboundWebhookPayload({
        customerNumber: stripPhone(customerNumber),
        integratedNumber: stripPhone(integratedNumber),
        uuid,
        requestId,
        text: filled.text,
        contentType: "text",
        ts,
      }),
    }
  }
  return {
    ok: false,
    message: "kind=button requires buttonPayload or buttonText (e.g. Select Aala Cabs)",
  }
}

async function resolveSimulatedSelectSnapshot(
  supabase: Parameters<typeof resolveSelectVendorTap>[0],
  raw: Record<string, unknown>,
): Promise<string | null> {
  const buttonPayload =
    readString(raw, ["buttonPayload", "button_payload", "payload"]) ??
    readString(asRecord(raw.button) ?? {}, ["payload"])
  if (buttonPayload) return null

  const buttonText =
    readString(raw, ["buttonText", "button_text"]) ??
    readString(asRecord(raw.button) ?? {}, ["text"])
  const customerNumber = readString(raw, ["customerNumber", "customer_number", "from"])
  if (!buttonText || !customerNumber) return null

  const resolved = await resolveSelectVendorTap(supabase, {
    waMessageId: "sim-select",
    fromPhone: stripPhone(customerNumber),
    timestamp: new Date().toISOString(),
    type: "text",
    textBody: buttonText,
    buttonPayload: null,
    interactionType: "free_text",
  })
  return resolved?.type === "book_token" ? resolved.quoteSnapshotId ?? null : null
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
