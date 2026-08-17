/**
 * Ping MSG91 without sending an OTP.
 * Reads only MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID from .env.local.
 * Never prints authkey. Never POST /api/v5/otp.
 *
 * Usage: npx tsx scripts/msg91-otp-ping.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { collectJsonKeys } from "../lib/sms/pure";

const CONTROL_ORIGIN = "https://control.msg91.com";
const API_V5 = "https://control.msg91.com/api/v5";
const API_ALIAS_V5 = "https://api.msg91.com/api/v5";

function loadMsg91EnvFromLocal(): { authKey: string; templateId: string } {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const picked: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key === "MSG91_AUTH_KEY" || key === "MSG91_OTP_TEMPLATE_ID") {
      picked[key] = trimmed.slice(eq + 1).trim();
    }
  }
  return {
    authKey: picked.MSG91_AUTH_KEY ?? "",
    templateId: picked.MSG91_OTP_TEMPLATE_ID ?? "",
  };
}

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function extractRows(body: unknown): unknown[] | null {
  if (Array.isArray(body)) {
    return body;
  }
  const record =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!record) {
    return null;
  }
  for (const key of ["data", "logs", "records", "list", "result"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function countRows(body: unknown): number | null {
  return extractRows(body)?.length ?? null;
}

function firstRowKeys(body: unknown): string[] | undefined {
  const rows = extractRows(body);
  const first = rows?.[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    return undefined;
  }
  return Object.keys(first);
}

function statusCounts(body: unknown): Record<string, number> | undefined {
  const rows = extractRows(body);
  if (!rows) {
    return undefined;
  }
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const status = record.status ?? record.deliveryStatus ?? record.state ?? record.failureReason;
    const key = status === undefined || status === null || status === "" ? "unknown" : String(status);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function safeLogSamples(body: unknown): unknown[] | undefined {
  const rows = extractRows(body);
  if (!rows) {
    return undefined;
  }
  return rows.slice(0, 10).map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return { status: "unreadable" };
    }
    const record = row as Record<string, unknown>;
    const tel = String(record.telNum ?? record.mobiles ?? "");
    const digits = tel.replace(/\D/g, "");
    return {
      last4: digits.slice(-4) || undefined,
      status: record.status,
      failureReason: record.failureReason || undefined,
      reportStatusDesc: record.reportStatusDesc,
      requestId: record.requestId,
      senderId: record.senderId,
      flowID: record.flowID,
      campaignName: record.campaignName,
      isApi: record.isApi,
    };
  });
}

function containsTemplateId(body: unknown, templateId: string): boolean {
  if (!templateId) {
    return false;
  }
  return JSON.stringify(body).includes(templateId);
}

async function pingReachability(url: string): Promise<void> {
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    console.info("[otp ping] reachability", { url, status: response.status });
  } catch (error) {
    console.info("[otp ping] reachability fail", {
      url,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function pingAuth(input: {
  label: string;
  url: string;
  method: "GET" | "POST";
  authKey: string;
  templateId: string;
}): Promise<void> {
  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        accept: "application/json",
        authkey: input.authKey,
        "content-type": "application/json",
      },
      body: input.method === "POST" ? "{}" : undefined,
    });
    const body: unknown = await response.json().catch(() => null);
    const record =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    const message = typeof record?.message === "string" ? record.message.slice(0, 120) : undefined;
    console.info("[otp ping] auth", {
      label: input.label,
      status: response.status,
      bodyKeys: collectJsonKeys(body),
      rowCount: countRows(body),
      rowKeys: firstRowKeys(body),
      statusCounts: statusCounts(body),
      samples: input.label.includes("logs") ? safeLogSamples(body) : undefined,
      templateIdPresent: containsTemplateId(body, input.templateId),
      type: typeof record?.type === "string" ? record.type : undefined,
      message,
    });
  } catch (error) {
    console.info("[otp ping] auth fail", {
      label: input.label,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function main(): Promise<void> {
  const { authKey, templateId } = loadMsg91EnvFromLocal();
  console.info("[otp ping] env", {
    authKeySet: Boolean(authKey),
    templateId: templateId || null,
  });

  if (!authKey) {
    console.info("[otp ping] skip authenticated calls — MSG91_AUTH_KEY is empty");
    await pingReachability(CONTROL_ORIGIN);
    return;
  }

  const startDate = isoDate(-1);
  const endDate = isoDate(0);
  const dateQuery = `startDate=${startDate}&endDate=${endDate}`;

  await pingReachability(CONTROL_ORIGIN);
  await pingAuth({
    label: "otp-analytics",
    url: `${API_V5}/report/analytics/p/otp?${dateQuery}`,
    method: "GET",
    authKey,
    templateId,
  });
  await pingAuth({
    label: "otp-logs",
    url: `${API_V5}/report/logs/otp?${dateQuery}`,
    method: "POST",
    authKey,
    templateId,
  });
  await pingAuth({
    label: "otp-analytics-alias",
    url: `${API_ALIAS_V5}/report/analytics/p/otp?${dateQuery}`,
    method: "GET",
    authKey,
    templateId,
  });

  await pingAuth({
    label: "sms-logs",
    url: `${API_V5}/report/logs/p/sms?${dateQuery}`,
    method: "POST",
    authKey,
    templateId,
  });
  const requestIdArg = process.argv.find((arg) => arg.startsWith("--request-id="))?.slice("--request-id=".length);
  const last4Arg = process.argv.find((arg) => arg.startsWith("--last4="))?.slice("--last4=".length);
  if (requestIdArg || last4Arg) {
    const { lookupMsg91OtpDelivery } = await import("../lib/sms/lookupOtpDelivery");
    const delivery = await lookupMsg91OtpDelivery({
      authKey,
      requestId: requestIdArg,
      last4: last4Arg,
    });
    console.info("[otp ping] lookup", delivery);
  }
}

void main();
