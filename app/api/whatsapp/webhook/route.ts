import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { verifyWebhookSignature } from "@/lib/whatsapp/webhook/verifyWebhookSignature";
import { parseWebhookPayload } from "@/lib/whatsapp/webhook/parseWebhookPayload";
import { parseInboundAction } from "@/lib/whatsapp/webhook/parseInboundAction";
import { enqueueWebhookAction } from "@/lib/whatsapp/webhook/enqueueWebhookAction";
import type { InboundWhatsAppMessage } from "@/lib/whatsapp/webhook/types";

const DUPLICATE_KEY_ERROR_CODE = "23505";

/**
 * Checklist 2.5 GET: Meta's webhook subscription challenge-response.
 */
export async function GET(request: NextRequest) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return jsonError(500, "Missing WHATSAPP_VERIFY_TOKEN. Copy .env.example to .env.local and fill it in.");
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
 * Checklist 2.5 POST: verify signature, dedupe + log every inbound message,
 * branch into job_queue rows only (Plan §7.2/§7.3), and ack fast — Meta
 * retries on timeout, so nothing here waits on WhatsApp sends or business
 * logic (that's Phase 3's job-queue workers).
 */
export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return jsonError(500, "Missing WHATSAPP_APP_SECRET. Copy .env.example to .env.local and fill it in.");
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signatureHeader, appSecret)) {
    return jsonError(401, "Invalid webhook signature");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const messages = parseWebhookPayload(payload);

  for (const message of messages) {
    try {
      const isDuplicate = await logInboundMessage(supabase, message);
      if (isDuplicate) continue;

      const action = parseInboundAction(message);
      await enqueueWebhookAction(supabase, action, message);
    } catch (error) {
      // Meta requires a fast 200 ack regardless (Checklist 2.5) — log and
      // keep processing the rest of the batch rather than failing the
      // whole webhook delivery over one bad message.
      console.error("[whatsapp webhook] failed to process inbound message", error);
    }
  }

  return jsonOk({ received: true });
}

/**
 * Returns true if this wa_message_id was already logged (duplicate
 * delivery per Plan §7.4's at-least-once retry note), false if this insert
 * newly recorded it.
 */
async function logInboundMessage(supabase: SupabaseClient, message: InboundWhatsAppMessage): Promise<boolean> {
  const { error } = await supabase.from("whatsapp_message_log").insert({
    direction: "inbound",
    wa_message_id: message.waMessageId,
    body_snapshot: message.textBody,
    button_payload: message.buttonPayload,
    interaction_type: message.interactionType,
    wa_status: "replied",
  });

  if (!error) return false;
  if (error.code === DUPLICATE_KEY_ERROR_CODE) return true;

  throw new Error(`Failed to log inbound WhatsApp message: ${error.message}`);
}
