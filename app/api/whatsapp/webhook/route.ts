import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { isMsg91WebhookPayload, parseMsg91Webhook } from "@/lib/whatsapp/webhook/parseMsg91Webhook";
import { parseWebhookPayload, parseWebhookStatuses } from "@/lib/whatsapp/webhook/parseWebhookPayload";
import { processWhatsAppWebhook } from "@/lib/whatsapp/webhook/processWhatsAppWebhook";
import {
  getMsg91WebhookSecret,
  readMsg91WebhookSecretHeader,
  verifyMsg91WebhookSecret,
} from "@/lib/whatsapp/webhook/verifyMsg91Webhook";
import { verifyWebhookSignature } from "@/lib/whatsapp/webhook/verifyWebhookSignature";

/**
 * GET is Meta's hub.challenge only. MSG91 Webhook (New) never calls GET.
 */
export async function GET(request: NextRequest) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return jsonError(403, "Meta webhook verification is not configured");
  }

  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return jsonError(403, "Webhook verification failed");
}

/**
 * Production inbound from MSG91 Webhook (New): flat JSON, stringified
 * `button` / `messages` / `interactive`. Meta `entry[].changes[]` + HMAC
 * still accepted so local fixtures keep working.
 *
 * Always ack 200 after auth — MSG91 retries up to 4 times if we exceed 8s
 * or return 5xx; 4xx (except 429) auto-pauses the MSG91 webhook.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // #region agent log
    fetch("http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f4fe3a" },
      body: JSON.stringify({
        sessionId: "f4fe3a",
        runId: "payment-tap",
        hypothesisId: "A",
        location: "app/api/whatsapp/webhook/route.ts:json",
        message: "webhook body not json",
        data: { rawLength: rawBody.length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return jsonError(400, "Request body must be valid JSON");
  }

  const msg91Payload = isMsg91WebhookPayload(payload);
  const payloadRecord =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  // #region agent log
  fetch("http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f4fe3a" },
    body: JSON.stringify({
      sessionId: "f4fe3a",
      runId: "payment-tap",
      hypothesisId: "A",
      location: "app/api/whatsapp/webhook/route.ts:entry",
      message: "webhook POST received",
      data: {
        msg91Payload,
        secretConfigured: Boolean(getMsg91WebhookSecret()),
        headerPresent: Boolean(readMsg91WebhookSecretHeader(request.headers)),
        keys: payloadRecord ? Object.keys(payloadRecord).slice(0, 20) : [],
        contentType: typeof payloadRecord?.contentType === "string" ? payloadRecord.contentType : null,
        eventName: typeof payloadRecord?.eventName === "string" ? payloadRecord.eventName : null,
        hasButton: Boolean(payloadRecord?.button),
        hasText: Boolean(payloadRecord?.text),
        direction: payloadRecord?.direction ?? null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (msg91Payload) {
    const expectedSecret = getMsg91WebhookSecret();
    if (!expectedSecret) {
      // #region agent log
      fetch("http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f4fe3a" },
        body: JSON.stringify({
          sessionId: "f4fe3a",
          runId: "payment-tap",
          hypothesisId: "B",
          location: "app/api/whatsapp/webhook/route.ts:secret-missing",
          message: "MSG91_WEBHOOK_SECRET missing",
          data: {},
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return jsonError(500, "Missing MSG91_WEBHOOK_SECRET. Copy .env.example to .env.local and fill it in.");
    }
    if (!verifyMsg91WebhookSecret(readMsg91WebhookSecretHeader(request.headers), expectedSecret)) {
      // #region agent log
      fetch("http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f4fe3a" },
        body: JSON.stringify({
          sessionId: "f4fe3a",
          runId: "payment-tap",
          hypothesisId: "B",
          location: "app/api/whatsapp/webhook/route.ts:secret-mismatch",
          message: "MSG91 webhook secret rejected",
          data: { headerPresent: Boolean(readMsg91WebhookSecretHeader(request.headers)) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return jsonError(401, "Invalid MSG91 webhook secret");
    }
  } else {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      return jsonError(500, "Missing WHATSAPP_APP_SECRET. Copy .env.example to .env.local and fill it in.");
    }
    if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
      return jsonError(401, "Invalid webhook signature");
    }
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const parsed = msg91Payload
    ? parseMsg91Webhook(payload)
    : { messages: parseWebhookPayload(payload), statuses: parseWebhookStatuses(payload), payments: [] };

  await processWhatsAppWebhook(supabase, parsed.messages, parsed.statuses, parsed.payments, payload);

  return jsonOk({ received: true, provider: msg91Payload ? "msg91" : "meta" });
}
