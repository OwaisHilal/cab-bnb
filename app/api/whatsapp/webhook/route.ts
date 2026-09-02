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
    return jsonError(400, "Request body must be valid JSON");
  }

  const msg91Payload = isMsg91WebhookPayload(payload);

  if (msg91Payload) {
    const expectedSecret = getMsg91WebhookSecret();
    if (!expectedSecret) {
      return jsonError(500, "Missing MSG91_WEBHOOK_SECRET. Copy .env.example to .env.local and fill it in.");
    }
    if (!verifyMsg91WebhookSecret(readMsg91WebhookSecretHeader(request.headers), expectedSecret)) {
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
    : { messages: parseWebhookPayload(payload), statuses: parseWebhookStatuses(payload) };

  await processWhatsAppWebhook(supabase, parsed.messages, parsed.statuses);

  return jsonOk({ received: true, provider: msg91Payload ? "msg91" : "meta" });
}
