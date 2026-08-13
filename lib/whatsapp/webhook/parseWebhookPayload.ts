import type { InboundInteractionType, InboundWhatsAppMessage, InboundWhatsAppStatus } from "./types";

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

interface RawStatus {
  id?: string;
  status?: string;
  timestamp?: string;
}

interface RawChangeValue {
  messages?: RawMessage[];
  statuses?: RawStatus[];
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
 * receipts) carry no `messages` array and are skipped here — see
 * `parseWebhookStatuses` below for that separate event shape (Phase 3
 * final pass, Plan §8's `viewed` quote_snapshot state).
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

/**
 * Meta nests message delivery-status events under
 * entry[].changes[].value.statuses[] — a completely separate array from
 * `messages[]` on the same webhook `value` object (a single POST can
 * carry either, both, or neither). Phase 3 final pass: only `status ===
 * "read"` is consumed today, to advance `quote_snapshots.status` from
 * `sent` to `viewed` (Plan §8) — `delivered`/`sent`/`failed` statuses are
 * parsed but left for callers to ignore.
 */
export function parseWebhookStatuses(payload: unknown): InboundWhatsAppStatus[] {
  const raw = payload as RawWebhookPayload;
  const statuses: InboundWhatsAppStatus[] = [];

  for (const entry of raw?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const status of change?.value?.statuses ?? []) {
        if (!status.id || !status.status) continue;

        statuses.push({
          waMessageId: status.id,
          status: status.status,
          timestamp: status.timestamp ?? new Date().toISOString(),
        });
      }
    }
  }

  return statuses;
}
