/**
 * Deno MSG91 WhatsApp client. Keep in sync with lib/msg91/{types,pure,sendSession}.ts.
 * Edge Functions cannot import Next `server-only` modules, so this file
 * duplicates the helper.
 */

export interface Msg91SendResult {
  configured: boolean;
  success: boolean;
  waMessageId?: string;
  error?: string;
}

export interface Msg91TemplateComponent {
  type: string;
  value: string;
  subtype?: string;
}

export interface SendMsg91TemplateInput {
  toE164: string;
  templateName: string;
  languageCode: string;
  namespace?: string;
  components?: Record<string, Msg91TemplateComponent>;
  crqid?: string;
}

export interface Msg91WhatsAppButton {
  id: string;
  title: string;
}

export interface SendMsg91InteractiveInput {
  toE164: string;
  bodyText: string;
  buttons: Msg91WhatsAppButton[];
  footerText?: string;
}

export interface SendMsg91CtaUrlInput {
  toE164: string;
  bodyText: string;
  buttonTitle: string;
  url: string;
  footerText?: string;
}

export interface Msg91WhatsAppListRow {
  id: string;
  title: string;
  description?: string;
}

export interface Msg91WhatsAppListSection {
  title: string;
  rows: Msg91WhatsAppListRow[];
}

export interface SendMsg91InteractiveListInput {
  toE164: string;
  bodyText: string;
  buttonText: string;
  sections: Msg91WhatsAppListSection[];
  headerText?: string;
  footerText?: string;
}

export interface SendMsg91TextInput {
  toE164: string;
  bodyText: string;
}

export interface SendMsg91ImageInput {
  toE164: string;
  imageUrl: string;
  caption: string;
}

export interface Msg91PaymentLinkItem {
  name: string;
  amount: number;
  quantity: number;
}

export interface SendMsg91PaymentLinkInput {
  toE164: string;
  bodyText: string;
  footerText?: string;
  headerImageUrl?: string;
  items: Msg91PaymentLinkItem[];
  crqid?: string;
}

export const MSG91_WHATSAPP_BULK_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

export const MSG91_WHATSAPP_OUTBOUND_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/";

export function stripE164Plus(phone: string): string {
  return phone.trim().replace(/^\+/, "");
}

export function resolveMsg91SendCredentials(env: {
  MSG91_AUTH_KEY?: string;
  MSG91_WHATSAPP_INTEGRATED_NUMBER?: string;
}): { authKey: string; integratedNumber: string } | null {
  const authKey = env.MSG91_AUTH_KEY?.trim() ?? "";
  const integratedNumber = env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim() ?? "";
  if (!authKey || !integratedNumber) {
    return null;
  }
  return { authKey, integratedNumber };
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
  };

  const footerText = input.footerText?.trim();
  if (footerText) {
    interactive.footer = { text: footerText.slice(0, 60) };
  }

  return buildMsg91InteractiveSessionBody(input.toE164, integratedNumber, interactive);
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
  init: { body?: string | null },
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
      method: "POST",
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

/**
 * Reads MSG91_AUTH_KEY and MSG91_WHATSAPP_INTEGRATED_NUMBER from Deno env
 * (supabase secrets). Missing either returns { configured: false }.
 */
export async function sendMsg91TemplateMessage(
  input: SendMsg91TemplateInput,
): Promise<Msg91SendResult> {
  return sendMsg91TemplateWithConfig(input, {
    authKey: Deno.env.get("MSG91_AUTH_KEY") ?? undefined,
    integratedNumber: Deno.env.get("MSG91_WHATSAPP_INTEGRATED_NUMBER") ?? undefined,
  });
}
