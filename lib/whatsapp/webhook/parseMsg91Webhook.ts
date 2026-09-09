import type {
  InboundInteractionType,
  InboundWhatsAppMessage,
  InboundWhatsAppPayment,
  InboundWhatsAppStatus,
} from "./types";

const OUTBOUND_STATUS_EVENTS = new Set(["sent", "delivered", "read", "failed", "submitted"]);
const PAID_PAYMENT_STATUSES = new Set(["paid", "success", "successful", "captured", "completed", "complete"]);
const UNPAID_PAYMENT_STATUSES = new Set([
  "unpaid",
  "pending",
  "failed",
  "cancelled",
  "canceled",
  "expired",
  "user_dropped",
  "dropped",
]);

export type ParsedMsg91Webhook = {
  messages: InboundWhatsAppMessage[];
  statuses: InboundWhatsAppStatus[];
  payments: InboundWhatsAppPayment[];
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
    typeof raw.interactive === "string" ||
    hasValue(raw.paymentStatus) ||
    hasValue(raw.payment_status) ||
    hasValue(raw.webhookType) ||
    hasValue(raw.webhook_type) ||
    hasValue(raw.orders)
  );
}

export function isPaidPaymentStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized || UNPAID_PAYMENT_STATUSES.has(normalized)) {
    return false;
  }
  return PAID_PAYMENT_STATUSES.has(normalized);
}

export function parseMsg91Webhook(payload: unknown): ParsedMsg91Webhook {
  if (!isMsg91WebhookPayload(payload)) {
    return { messages: [], statuses: [], payments: [] };
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

  const payment = parsePaymentReport(raw);
  if (payment) {
    return { messages: [], statuses, payments: [payment] };
  }

  if (isOutboundStatus && direction === "1") {
    return { messages: [], statuses, payments: [] };
  }

  const message = parseInboundMessage(raw);
  return {
    messages: message ? [message] : [],
    statuses,
    payments: [],
  };
}

function isPaymentReportPayload(raw: Record<string, unknown>): boolean {
  const eventName = String(raw.eventName ?? raw.event ?? "").trim().toLowerCase();
  const webhookType = String(raw.webhookType ?? raw.webhook_type ?? "").trim().toLowerCase();
  return (
    eventName.includes("payment") ||
    webhookType.includes("payment") ||
    hasValue(raw.paymentStatus) ||
    hasValue(raw.payment_status)
  );
}

function parsePaymentReport(raw: Record<string, unknown>): InboundWhatsAppPayment | null {
  if (!isPaymentReportPayload(raw)) {
    return null;
  }

  const paymentStatus =
    readString(raw, ["paymentStatus", "payment_status"]) ??
    readNestedOrderStatus(raw) ??
    String(raw.eventName ?? raw.event ?? "").trim();

  return {
    crqid: readString(raw, ["crqid", "CRQID", "CrqId"]),
    customerNumber: readString(raw, ["customerNumber", "customer_number"]),
    paymentStatus,
    paid: isPaidPaymentStatus(paymentStatus),
    waMessageId: readString(raw, ["uuid", "message_uuid", "replyMsgId"]),
    timestamp: readString(raw, ["ts", "requestedAt"]) ?? new Date().toISOString(),
    rawStatus: paymentStatus,
  };
}

function readNestedOrderStatus(raw: Record<string, unknown>): string | null {
  const orders = asArray(parseJsonValue(raw.orders));
  const first = asRecord(orders[0]);
  if (!first) {
    return null;
  }
  return (
    readNonEmpty(first.status) ??
    readNonEmpty(first.paymentStatus) ??
    readNonEmpty(first.payment_status)
  );
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
  const hasButtonChrome =
    Boolean(topButton) ||
    Boolean(nestedButton) ||
    Boolean(asRecord(topInteractive?.button_reply)) ||
    Boolean(asRecord(nestedInteractive?.button_reply));
  const buttonReply = hasButtonChrome && !listReply;

  const buttonTitle =
    readNonEmpty(topButton?.text) ??
    readNonEmpty(nestedButton?.text) ??
    readNonEmpty(asRecord(topInteractive?.button_reply)?.title) ??
    readNonEmpty(asRecord(nestedInteractive?.button_reply)?.title) ??
    readNonEmpty(asRecord(topInteractive?.list_reply)?.title) ??
    readNonEmpty(asRecord(nestedInteractive?.list_reply)?.title) ??
    null;
  const rawText =
    readString(raw, ["text"]) ?? readNonEmpty(asRecord(nestedMessage?.text)?.body) ?? null;
  const textBody = buttonTitle ?? rawText;

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
    groupId: readString(raw, ["group_id", "groupId"]) ?? readNonEmpty(nestedMessage?.group_id) ?? readNonEmpty(nestedMessage?.groupId),
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
