import type {
  Msg91OtpTemplateConfig,
  Msg91SendCredentials,
  Msg91SendResult,
  Msg91TemplateComponent,
  SendMsg91ImageInput,
  SendMsg91InteractiveInput,
  SendMsg91InteractiveListInput,
  SendMsg91CtaUrlInput,
  SendMsg91PaymentLinkInput,
  SendMsg91TemplateInput,
  SendMsg91TextInput,
} from "./types";

/** Documented fallback when MSG91_OTP_TEMPLATE_NAME is unset — not a Green claim. */
export const DEFAULT_MSG91_OTP_TEMPLATE_NAME = "otp_verification";

/** Same language code the Graph OTP path used (`en_US`). */
export const DEFAULT_MSG91_OTP_TEMPLATE_LANGUAGE = "en_US";

/**
 * Official bulk template endpoint (docs.msg91.com/whatsapp/template-bulk
 * and CRQID help). The OTP help article lists api.msg91.com as an alias.
 */
export const MSG91_WHATSAPP_BULK_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

/**
 * Session / interactive sends (docs.msg91.com/whatsapp/interactive-whatsapp-buttons,
 * send-message-in-text).
 */
export const MSG91_WHATSAPP_OUTBOUND_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/";

export function stripE164Plus(phone: string): string {
  return phone.trim().replace(/^\+/, "");
}

export function resolveMsg91SendCredentials(env: {
  MSG91_AUTH_KEY?: string;
  MSG91_WHATSAPP_INTEGRATED_NUMBER?: string;
}): Msg91SendCredentials | null {
  const authKey = env.MSG91_AUTH_KEY?.trim() ?? "";
  const integratedNumber = env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim() ?? "";
  if (!authKey || !integratedNumber) {
    return null;
  }
  return { authKey, integratedNumber };
}

export function resolveMsg91OtpTemplateConfig(env: {
  MSG91_OTP_TEMPLATE_NAME?: string;
  MSG91_OTP_TEMPLATE_NAMESPACE?: string;
  MSG91_OTP_TEMPLATE_LANGUAGE?: string;
}): Msg91OtpTemplateConfig {
  const templateName = env.MSG91_OTP_TEMPLATE_NAME?.trim() || DEFAULT_MSG91_OTP_TEMPLATE_NAME;
  const languageCode = env.MSG91_OTP_TEMPLATE_LANGUAGE?.trim() || DEFAULT_MSG91_OTP_TEMPLATE_LANGUAGE;
  const namespace = env.MSG91_OTP_TEMPLATE_NAMESPACE?.trim();
  if (namespace) {
    return { templateName, languageCode, namespace };
  }
  return { templateName, languageCode };
}

/**
 * MSG91 authentication-template components (msg91.com/help/whatsapp/whatsapp-otp).
 * `button_1` copy-code uses subtype `url` with the same OTP as `body_1`.
 */
export function buildMsg91AuthOtpComponents(
  code: string,
): Record<string, Msg91TemplateComponent> {
  return {
    body_1: { type: "text", value: code },
    button_1: { subtype: "url", type: "text", value: code },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickNonEmptyString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Maps MSG91 send JSON to the existing `waMessageId` field.
 * Prefer Meta WAMID (`uuid`) when present; otherwise MSG91 `requestId` /
 * `request_id` (official SDK bulk-response example).
 */
export function mapMsg91ResponseToWaMessageId(body: unknown): string | undefined {
  const root = asRecord(body);
  if (!root) {
    return undefined;
  }

  const nested = asRecord(root.data);
  const uuid = pickNonEmptyString(root, ["uuid"]) ?? (nested ? pickNonEmptyString(nested, ["uuid"]) : undefined);
  if (uuid) {
    return uuid;
  }

  return (
    pickNonEmptyString(root, ["requestId", "request_id"]) ??
    (nested ? pickNonEmptyString(nested, ["requestId", "request_id"]) : undefined)
  );
}

export function isMsg91ErrorBody(body: unknown): boolean {
  const root = asRecord(body);
  if (!root) {
    return false;
  }
  if (root.hasError === true) {
    return true;
  }
  if (root.type === "error") {
    return true;
  }
  if (typeof root.status === "string") {
    const status = root.status.toLowerCase();
    return status === "error" || status === "fail" || status === "failed";
  }
  return false;
}

export function buildMsg91BulkTemplateBody(
  input: SendMsg91TemplateInput,
  integratedNumber: string,
): Record<string, unknown> {
  const template: Record<string, unknown> = {
    name: input.templateName,
    language: {
      code: input.languageCode,
      policy: "deterministic",
    },
    to_and_components: [
      {
        to: [stripE164Plus(input.toE164)],
        components: input.components ?? {},
      },
    ],
  };

  const namespace = input.namespace?.trim();
  if (namespace) {
    template.namespace = namespace;
  }

  const body: Record<string, unknown> = {
    integrated_number: stripE164Plus(integratedNumber),
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template,
    },
  };

  const crqid = input.crqid?.trim();
  if (crqid) {
    body.CRQID = crqid;
  }

  return body;
}

function truncateButtonTitle(title: string): string {
  return title.trim().slice(0, 20);
}

function truncateListTitle(title: string): string {
  return title.trim().slice(0, 24);
}

function truncateListDescription(description: string): string {
  return description.trim().slice(0, 72);
}

function truncateListButtonText(text: string): string {
  return text.trim().slice(0, 20);
}

/** MSG91 session interactive POST body (recipient_number + content_type: interactive). */
function buildMsg91InteractiveSessionBody(
  toE164: string,
  integratedNumber: string,
  interactive: Record<string, unknown>,
): Record<string, unknown> {
  return {
    recipient_number: stripE164Plus(toE164),
    integrated_number: stripE164Plus(integratedNumber),
    content_type: "interactive",
    interactive,
  };
}

export function buildMsg91InteractiveListBody(
  input: SendMsg91InteractiveListInput,
  integratedNumber: string,
): Record<string, unknown> {
  const interactive: Record<string, unknown> = {
    type: "list",
    body: { text: input.bodyText },
    action: {
      button: truncateListButtonText(input.buttonText),
      sections: input.sections.slice(0, 10).map((section) => ({
        title: truncateListTitle(section.title),
        rows: section.rows.slice(0, 10).map((row) => ({
          id: row.id,
          title: truncateListTitle(row.title),
          ...(row.description
            ? { description: truncateListDescription(row.description) }
            : {}),
        })),
      })),
    },
  };

  const headerText = input.headerText?.trim();
  if (headerText) {
    interactive.header = { type: "text", text: headerText.slice(0, 60) };
  }

  const footerText = input.footerText?.trim();
  if (footerText) {
    interactive.footer = { text: footerText.slice(0, 60) };
  }

  return buildMsg91InteractiveSessionBody(input.toE164, integratedNumber, interactive);
}

export const MSG91_PAYMENT_LINK_ITEM_NAME_MAX = 60;

export function buildMsg91PaymentLinkBody(
  input: SendMsg91PaymentLinkInput,
  integratedNumber: string,
): Record<string, unknown> {
  const interactive: Record<string, unknown> = {
    type: "payment_link",
    body: { text: input.bodyText },
    items: input.items.map((item) => ({
      name: item.name.trim().slice(0, MSG91_PAYMENT_LINK_ITEM_NAME_MAX),
      amount: Number(item.amount),
      quantity: Number(item.quantity),
    })),
  };

  const headerImageUrl = input.headerImageUrl?.trim();
  if (headerImageUrl) {
    interactive.header = {
      type: "image",
      image: { link: headerImageUrl },
    };
  }

  const footerText = input.footerText?.trim();
  if (footerText) {
    interactive.footer = { text: footerText.slice(0, 60) };
  }

  const body = buildMsg91InteractiveSessionBody(input.toE164, integratedNumber, interactive);
  const crqid = input.crqid?.trim();
  if (crqid) {
    body.CRQID = crqid;
  }
  return body;
}

export function buildMsg91InteractiveButtonBody(
  input: SendMsg91InteractiveInput,
  integratedNumber: string,
): Record<string, unknown> {
  const interactive: Record<string, unknown> = {
    type: "button",
    body: { text: input.bodyText },
    action: {
      buttons: input.buttons.slice(0, 3).map((button) => ({
        type: "reply",
        reply: {
          id: button.id,
          title: truncateButtonTitle(button.title),
        },
      })),
    },
  };

  const footerText = input.footerText?.trim();
  if (footerText) {
    interactive.footer = { text: footerText.slice(0, 60) };
  }

  return buildMsg91InteractiveSessionBody(input.toE164, integratedNumber, interactive);
}

export function buildMsg91CtaUrlBody(
  input: SendMsg91CtaUrlInput,
  integratedNumber: string,
): Record<string, unknown> {
  const interactive: Record<string, unknown> = {
    type: "cta_url",
    body: { text: input.bodyText },
    action: {
      name: "cta_url",
      parameters: {
        display_text: truncateButtonTitle(input.buttonTitle),
        url: input.url,
      },
    },
  }

  const footerText = input.footerText?.trim()
  if (footerText) {
    interactive.footer = { text: footerText.slice(0, 60) }
  }

  return buildMsg91InteractiveSessionBody(input.toE164, integratedNumber, interactive)
}

export function buildMsg91TextOutboundUrl(
  input: SendMsg91TextInput,
  integratedNumber: string,
): string {
  const url = new URL(MSG91_WHATSAPP_OUTBOUND_URL);
  url.searchParams.set("integrated_number", stripE164Plus(integratedNumber));
  url.searchParams.set("recipient_number", stripE164Plus(input.toE164));
  url.searchParams.set("content_type", "text");
  url.searchParams.set("text", input.bodyText);
  return url.toString();
}

export function buildMsg91ImageMessageBody(
  input: SendMsg91ImageInput,
  integratedNumber: string,
): Record<string, unknown> {
  return {
    to_whatsapp_id: stripE164Plus(input.toE164),
    from_whatsapp_id: stripE164Plus(integratedNumber),
    message: {
      type: "image",
      image: {
        link: input.imageUrl,
        caption: input.caption,
      },
    },
  };
}

async function postMsg91Request(
  credentials: { authKey?: string; integratedNumber?: string } | null,
  url: string,
  init: { method?: string; body?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<Msg91SendResult> {
  const authKey = credentials?.authKey?.trim() ?? "";
  const integratedNumber = credentials?.integratedNumber?.trim() ?? "";

  if (!authKey || !integratedNumber) {
    return {
      configured: false,
      success: false,
      error: "MSG91 WhatsApp credentials are not configured",
    };
  }

  try {
    const response = await fetchImpl(url, {
      method: init.method ?? "POST",
      headers: {
        accept: "application/json",
        authkey: authKey,
        "content-type": "application/json",
      },
      body: init.body ?? undefined,
    });

    const responseBody: unknown = await response.json().catch(() => null);

    if (!response.ok || isMsg91ErrorBody(responseBody)) {
      return {
        configured: true,
        success: false,
        error: `MSG91 WhatsApp API returned ${response.status}: ${JSON.stringify(responseBody)}`,
      };
    }

    return {
      configured: true,
      success: true,
      waMessageId: mapMsg91ResponseToWaMessageId(responseBody),
    };
  } catch (error) {
    return {
      configured: true,
      success: false,
      error: error instanceof Error ? error.message : "Unknown MSG91 WhatsApp send error",
    };
  }
}

export async function sendMsg91PaymentLinkWithConfig(
  input: SendMsg91PaymentLinkInput,
  credentials: { authKey?: string; integratedNumber?: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Msg91SendResult> {
  const integratedNumber = credentials?.integratedNumber?.trim() ?? "";
  return postMsg91Request(
    credentials,
    MSG91_WHATSAPP_OUTBOUND_URL,
    {
      body: JSON.stringify(buildMsg91PaymentLinkBody(input, integratedNumber)),
    },
    fetchImpl,
  );
}

export async function sendMsg91InteractiveButtonWithConfig(
  input: SendMsg91InteractiveInput,
  credentials: { authKey?: string; integratedNumber?: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Msg91SendResult> {
  const integratedNumber = credentials?.integratedNumber?.trim() ?? "";
  return postMsg91Request(
    credentials,
    MSG91_WHATSAPP_OUTBOUND_URL,
    {
      body: JSON.stringify(buildMsg91InteractiveButtonBody(input, integratedNumber)),
    },
    fetchImpl,
  );
}

export async function sendMsg91CtaUrlWithConfig(
  input: SendMsg91CtaUrlInput,
  credentials: { authKey?: string; integratedNumber?: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Msg91SendResult> {
  const integratedNumber = credentials?.integratedNumber?.trim() ?? "";
  return postMsg91Request(
    credentials,
    MSG91_WHATSAPP_OUTBOUND_URL,
    {
      body: JSON.stringify(buildMsg91CtaUrlBody(input, integratedNumber)),
    },
    fetchImpl,
  );
}

export async function sendMsg91InteractiveListWithConfig(
  input: SendMsg91InteractiveListInput,
  credentials: { authKey?: string; integratedNumber?: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Msg91SendResult> {
  const integratedNumber = credentials?.integratedNumber?.trim() ?? "";
  return postMsg91Request(
    credentials,
    MSG91_WHATSAPP_OUTBOUND_URL,
    {
      body: JSON.stringify(buildMsg91InteractiveListBody(input, integratedNumber)),
    },
    fetchImpl,
  );
}

export async function sendMsg91TextWithConfig(
  input: SendMsg91TextInput,
  credentials: { authKey?: string; integratedNumber?: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Msg91SendResult> {
  const integratedNumber = credentials?.integratedNumber?.trim() ?? "";
  return postMsg91Request(
    credentials,
    buildMsg91TextOutboundUrl(input, integratedNumber),
    { body: null },
    fetchImpl,
  );
}

export async function sendMsg91ImageWithConfig(
  input: SendMsg91ImageInput,
  credentials: { authKey?: string; integratedNumber?: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Msg91SendResult> {
  const integratedNumber = credentials?.integratedNumber?.trim() ?? "";
  return postMsg91Request(
    credentials,
    MSG91_WHATSAPP_OUTBOUND_URL,
    {
      body: JSON.stringify(buildMsg91ImageMessageBody(input, integratedNumber)),
    },
    fetchImpl,
  );
}

export async function sendMsg91TemplateWithConfig(
  input: SendMsg91TemplateInput,
  credentials: { authKey?: string; integratedNumber?: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Msg91SendResult> {
  const integratedNumber = credentials?.integratedNumber?.trim() ?? "";
  return postMsg91Request(
    credentials,
    MSG91_WHATSAPP_BULK_URL,
    {
      body: JSON.stringify(buildMsg91BulkTemplateBody(input, integratedNumber)),
    },
    fetchImpl,
  );
}
