import type {
  Msg91OtpTemplateConfig,
  Msg91SendCredentials,
  Msg91SendResult,
  Msg91TemplateComponent,
  SendMsg91TemplateInput,
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

export async function sendMsg91TemplateWithConfig(
  input: SendMsg91TemplateInput,
  credentials: { authKey?: string; integratedNumber?: string } | null,
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
    const response = await fetchImpl(MSG91_WHATSAPP_BULK_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        authkey: authKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildMsg91BulkTemplateBody(input, integratedNumber)),
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
