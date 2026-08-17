/**
 * Deno MSG91 WhatsApp client. Keep in sync with lib/msg91/{types,pure,send}.ts.
 * Edge Functions cannot import Next `server-only` modules, so this file
 * duplicates the helper. Phase 1 ships it unused — Edge live send stays on
 * the existing Graph client in whatsapp.ts until Phase 3.
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

export const MSG91_WHATSAPP_BULK_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

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
