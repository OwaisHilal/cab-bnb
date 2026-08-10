import type { InboundInteractionType, InboundWhatsAppMessage } from "./types";

interface RawInteractiveReply {
  id?: string;
}

interface RawMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    button_reply?: RawInteractiveReply;
    list_reply?: RawInteractiveReply;
  };
}

interface RawChangeValue {
  messages?: RawMessage[];
}

interface RawChange {
  value?: RawChangeValue;
}

interface RawEntry {
  changes?: RawChange[];
}

interface RawWebhookPayload {
  entry?: RawEntry[];
}

/**
 * Meta nests inbound messages under entry[].changes[].value.messages[]
 * (Checklist 2.5). Status-only webhook deliveries (delivered/read
 * receipts) carry no `messages` array and are intentionally skipped —
 * Plan §7 only cares about customer/vendor replies, not delivery receipts.
 */
export function parseWebhookPayload(payload: unknown): InboundWhatsAppMessage[] {
  const raw = payload as RawWebhookPayload;
  const messages: InboundWhatsAppMessage[] = [];

  for (const entry of raw?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const message of change?.value?.messages ?? []) {
        if (!message.id || !message.from) continue;

        const buttonPayload =
          message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? null;

        let interactionType: InboundInteractionType | null = null;
        if (message.interactive?.button_reply?.id) {
          interactionType = "button_click";
        } else if (message.interactive?.list_reply?.id) {
          interactionType = "list_reply";
        } else if (message.text?.body) {
          interactionType = "free_text";
        }

        messages.push({
          waMessageId: message.id,
          fromPhone: message.from,
          timestamp: message.timestamp ?? new Date().toISOString(),
          type: message.type ?? "unknown",
          textBody: message.text?.body ?? null,
          buttonPayload,
          interactionType,
        });
      }
    }
  }

  return messages;
}
