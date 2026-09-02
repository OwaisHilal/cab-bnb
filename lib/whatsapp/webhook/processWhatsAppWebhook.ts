import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueWebhookAction } from "./enqueueWebhookAction";
import { parseInboundAction } from "./parseInboundAction";
import type { InboundWhatsAppMessage, InboundWhatsAppStatus } from "./types";

const DUPLICATE_KEY_ERROR_CODE = "23505";
const READ_STATUS = "read";

export async function processWhatsAppWebhook(
  supabase: SupabaseClient,
  messages: InboundWhatsAppMessage[],
  statuses: InboundWhatsAppStatus[],
): Promise<void> {
  for (const message of messages) {
    try {
      const isDuplicate = await logInboundMessage(supabase, message);
      if (isDuplicate) continue;

      const action = parseInboundAction(message);
      await enqueueWebhookAction(supabase, action, message);
    } catch (error) {
      console.error("[whatsapp webhook] failed to process inbound message", error);
    }
  }

  for (const status of statuses) {
    try {
      await applyStatusUpdate(supabase, status);
    } catch (error) {
      console.error("[whatsapp webhook] failed to process status event", error);
    }
  }
}

async function applyStatusUpdate(supabase: SupabaseClient, status: InboundWhatsAppStatus): Promise<void> {
  const { error: logError } = await supabase
    .from("whatsapp_message_log")
    .update({ wa_status: status.status })
    .eq("wa_message_id", status.waMessageId);

  if (logError) throw new Error(`Failed to update whatsapp_message_log status: ${logError.message}`);

  if (status.status !== READ_STATUS) return;

  const { error: snapshotError } = await supabase
    .from("quote_snapshots")
    .update({ status: "viewed" })
    .eq("wa_message_id", status.waMessageId)
    .eq("status", "sent");

  if (snapshotError) throw new Error(`Failed to mark quote_snapshot viewed: ${snapshotError.message}`);
}

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
