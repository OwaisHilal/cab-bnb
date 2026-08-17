import { isMsg91ErrorBody } from "@/lib/msg91/pure";

const REDACTED_KEYS = new Set(["otp", "authkey", "auth_key", "authKey"]);

export interface SendOtpSmsResult {
  configured: boolean;
  success: boolean;
  error?: string;
  httpStatus?: number;
  msg91Type?: string;
  msg91Message?: string;
  requestId?: string;
  bodyKeys?: string[];
  sanitizedBody?: unknown;
}

export const MSG91_OTP_SEND_URL = "https://control.msg91.com/api/v5/otp";

export function resolveMsg91OtpSmsCredentials(env: {
  MSG91_AUTH_KEY?: string;
  MSG91_OTP_TEMPLATE_ID?: string;
}): { authKey: string; templateId: string } | null {
  const authKey = env.MSG91_AUTH_KEY?.trim() ?? "";
  const templateId = env.MSG91_OTP_TEMPLATE_ID?.trim() ?? "";
  if (!authKey || !templateId) {
    return null;
  }
  return { authKey, templateId };
}

function stripE164Plus(phone: string): string {
  return phone.trim().replace(/^\+/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readScalarString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

export function collectJsonKeys(body: unknown): string[] {
  const record = asRecord(body);
  return record ? Object.keys(record) : [];
}

export function pickMsg91OtpRequestId(body: unknown): string | undefined {
  const root = asRecord(body);
  if (!root) {
    return undefined;
  }
  const nested = asRecord(root.data);
  return (
    readScalarString(root, ["request_id", "requestId", "message"]) ??
    (nested ? readScalarString(nested, ["request_id", "requestId", "message"]) : undefined)
  );
}

export function sanitizeMsg91OtpResponseBody(body: unknown, maxString = 120): unknown {
  if (typeof body === "string") {
    return body.length > maxString ? `${body.slice(0, maxString)}…` : body;
  }
  if (body === null || typeof body !== "object") {
    return body;
  }
  if (Array.isArray(body)) {
    return body.slice(0, 20).map((item) => sanitizeMsg91OtpResponseBody(item, maxString));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key) || REDACTED_KEYS.has(key.toLowerCase())) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = sanitizeMsg91OtpResponseBody(value, maxString);
  }
  return out;
}

function isMsg91OtpSuccessBody(body: unknown): boolean {
  if (isMsg91ErrorBody(body)) {
    return false;
  }
  const record = asRecord(body);
  const type = record ? readScalarString(record, ["type"]) : undefined;
  return type !== undefined && type.toLowerCase() === "success";
}

function diagnosticFields(status: number, body: unknown): Pick<
  SendOtpSmsResult,
  "httpStatus" | "msg91Type" | "msg91Message" | "requestId" | "bodyKeys" | "sanitizedBody"
> {
  const record = asRecord(body);
  return {
    httpStatus: status,
    msg91Type: record ? readScalarString(record, ["type"]) : undefined,
    msg91Message: record ? readScalarString(record, ["message"]) : undefined,
    requestId: pickMsg91OtpRequestId(body),
    bodyKeys: collectJsonKeys(body),
    sanitizedBody: sanitizeMsg91OtpResponseBody(body),
  };
}

export async function sendMsg91OtpSmsWithConfig(
  phoneE164: string,
  code: string,
  credentials: { authKey?: string; templateId?: string } | null,
  options: { otpLength: number; otpExpiryMinutes: number },
  fetchImpl: typeof fetch = fetch,
): Promise<SendOtpSmsResult> {
  const authKey = credentials?.authKey?.trim() ?? "";
  const templateId = credentials?.templateId?.trim() ?? "";

  if (!authKey || !templateId) {
    return {
      configured: false,
      success: false,
      error: "MSG91 OTP is not configured",
    };
  }

  const query = new URLSearchParams({
    template_id: templateId,
    mobile: stripE164Plus(phoneE164),
    otp: code,
    otp_length: String(options.otpLength),
    otp_expiry: String(options.otpExpiryMinutes),
  });

  try {
    const response = await fetchImpl(`${MSG91_OTP_SEND_URL}?${query.toString()}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authkey: authKey,
        "content-type": "application/json",
      },
      body: "{}",
    });

    const responseBody: unknown = await response.json().catch(() => null);
    const diagnostics = diagnosticFields(response.status, responseBody);

    if (!response.ok || !isMsg91OtpSuccessBody(responseBody)) {
      return {
        configured: true,
        success: false,
        error: `MSG91 OTP API returned ${response.status}: ${JSON.stringify(responseBody)}`,
        ...diagnostics,
      };
    }

    return { configured: true, success: true, ...diagnostics };
  } catch (error) {
    return {
      configured: true,
      success: false,
      error: error instanceof Error ? error.message : "Unknown MSG91 OTP send error",
    };
  }
}
