import type { InboundInteractionType, InboundWhatsAppMessage, InboundWhatsAppStatus } from "./types";

const OUTBOUND_STATUS_EVENTS = new Set(["sent", "delivered", "read", "failed", "submitted"]);

export type ParsedMsg91Webhook = {
  messages: InboundWhatsAppMessage[];
  statuses: InboundWhatsAppStatus[];
};

/**
 * MSG91 Webhook (New) is a flat JSON object. Nested Meta-like pieces
 * (`messages`, `button`, `interactive`, `contacts`, `content`) arrive as
 * **stringified** JSON. WhatsApp/Meta never POST to this app when MSG91 is
 * the BSP — Meta delivers to MSG91, MSG91 forwards here.
 *
 * Guide: https://msg91.com/help/webhook-new/how-to-receive-whatsapp-delivery-reports-via-webhook-new
 */
export function isMsg91WebhookPayload(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const raw = payload as Record<string, unknown>;
  if (Array.isArray(raw.entry)) {
    return false;
  }

  return (
    hasValue(raw.customerNumber) ||
    hasValue(raw.customer_number) ||
    hasValue(raw.integratedNumber) ||
    hasValue(raw.integrated_number) ||
    hasValue(raw.eventName) ||
    hasValue(raw.uuid) ||
    raw.direction === 0 ||
    raw.direction === 1 ||
    raw.direction === "0" ||
    raw.direction === "1" ||
    typeof raw.button === "string" ||
    typeof raw.messages === "string" ||
    typeof raw.interactive === "string"
  );
}

export function parseMsg91Webhook(payload: unknown): ParsedMsg91Webhook {
  if (!isMsg91WebhookPayload(payload)) {
    return { messages: [], statuses: [] };
  }

  const raw = payload as Record<string, unknown>;
  const direction = String(raw.direction ?? "").trim();
  const eventName = String(raw.eventName ?? raw.event ?? "").trim().toLowerCase();
  const isOutboundStatus = OUTBOUND_STATUS_EVENTS.has(eventName) && direction !== "0";

  const statuses: InboundWhatsAppStatus[] = [];
  if (isOutboundStatus) {
    const waMessageId = readString(raw, ["uuid", "message_uuid", "replyMsgId"]);
    if (waMessageId) {
      statuses.push({
        waMessageId,
        status: eventName,
        timestamp: readString(raw, ["ts", "requestedAt"]) ?? new Date().toISOString(),
      });
    }
  }

  if (isOutboundStatus && direction === "1") {
    return { messages: [], statuses };
  }

  const message = parseInboundMessage(raw);
  return {
    messages: message ? [message] : [],
    statuses,
  };
}

function parseInboundMessage(raw: Record<string, unknown>): InboundWhatsAppMessage | null {
  const nestedMessages = asArray(parseJsonValue(raw.messages));
  const nestedMessage = asRecord(nestedMessages[0]);
  const topButton = parseButtonObject(raw.button);
  const nestedButton = parseButtonObject(nestedMessage?.button);
  const topInteractive = asRecord(parseJsonValue(raw.interactive));
  const nestedInteractive = asRecord(nestedMessage?.interactive);

  const buttonPayload =
    readNonEmpty(topButton?.payload) ??
    readNonEmpty(nestedButton?.payload) ??
    readNonEmpty(asRecord(topInteractive?.button_reply)?.id) ??
    readNonEmpty(asRecord(nestedInteractive?.button_reply)?.id) ??
    readNonEmpty(asRecord(topInteractive?.list_reply)?.id) ??
    readNonEmpty(asRecord(nestedInteractive?.list_reply)?.id) ??
    null;

  const listReply =
    Boolean(asRecord(topInteractive?.list_reply)?.id) || Boolean(asRecord(nestedInteractive?.list_reply)?.id);
  const buttonReply =
    Boolean(buttonPayload) &&
    !listReply &&
    (Boolean(topButton) ||
      Boolean(nestedButton) ||
      Boolean(asRecord(topInteractive?.button_reply)) ||
      Boolean(asRecord(nestedInteractive?.button_reply)));

  const textBody =
    readString(raw, ["text"]) ??
    readNonEmpty(asRecord(nestedMessage?.text)?.body) ??
    readNonEmpty(topButton?.text) ??
    readNonEmpty(nestedButton?.text) ??
    readNonEmpty(asRecord(topInteractive?.button_reply)?.title) ??
    readNonEmpty(asRecord(nestedInteractive?.button_reply)?.title) ??
    readNonEmpty(asRecord(topInteractive?.list_reply)?.title) ??
    readNonEmpty(asRecord(nestedInteractive?.list_reply)?.title) ??
    null;

  const contacts = asArray(parseJsonValue(raw.contacts));
  const contact = asRecord(contacts[0]);
  const fromPhone =
    readString(raw, ["customerNumber", "customer_number"]) ??
    readNonEmpty(nestedMessage?.from) ??
    readNonEmpty(contact?.wa_id) ??
    null;
  const waMessageId =
    readString(raw, ["uuid", "message_uuid"]) ?? readNonEmpty(nestedMessage?.id) ?? null;

  if (!fromPhone || !waMessageId) {
    return null;
  }

  let interactionType: InboundInteractionType | null = null;
  if (listReply) {
    interactionType = "list_reply";
  } else if (buttonReply) {
    interactionType = "button_click";
  } else if (textBody) {
    interactionType = "free_text";
  }

  const type =
    readString(raw, ["contentType", "content_type", "message_type"]) ??
    readNonEmpty(nestedMessage?.type) ??
    (buttonReply ? "button" : textBody ? "text" : "unknown");

  return {
    waMessageId,
    fromPhone,
    timestamp: readString(raw, ["ts", "requestedAt"]) ?? readNonEmpty(nestedMessage?.timestamp) ?? new Date().toISOString(),
    type,
    textBody,
    buttonPayload,
    interactionType,
  };
}

function parseButtonObject(value: unknown): { payload?: string; text?: string } | null {
  const parsed = asRecord(parseJsonValue(value)) ?? asRecord(value);
  if (!parsed) {
    return null;
  }
  const payload = readNonEmpty(parsed.payload);
  const text = readNonEmpty(parsed.text);
  if (!payload && !text) {
    return null;
  }
  return { payload: payload ?? undefined, text: text ?? undefined }
}

function parseJsonValue(value: unknown): unknown {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function readNonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readNonEmpty(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}
