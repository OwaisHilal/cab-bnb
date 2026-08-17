import { collectJsonKeys } from "./pure";
import { phoneLast4 } from "@/lib/utils/phone";

const OTP_LOGS_URL = "https://control.msg91.com/api/v5/report/logs/otp";
const SMS_LOGS_URL = "https://control.msg91.com/api/v5/report/logs/p/sms";

function ymdInKolkata(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function extractRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row));
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }
  const record = body as Record<string, unknown>;
  for (const key of ["data", "logs", "records", "list", "result"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row));
    }
  }
  return [];
}

function safeRow(row: Record<string, unknown>): {
  last4?: string;
  status?: unknown;
  failureReason?: unknown;
  reportStatusDesc?: unknown;
  requestId?: unknown;
  uuid?: unknown;
  crqId?: unknown;
  senderId?: unknown;
} {
  const tel = String(row.telNum ?? row.mobiles ?? "");
  return {
    last4: phoneLast4(tel),
    status: row.status,
    failureReason: row.failureReason || undefined,
    reportStatusDesc: row.reportStatusDesc,
    requestId: row.requestId,
    uuid: row.UUID ?? row.uuid,
    crqId: row.CRQID,
    senderId: row.senderId,
  };
}

function uniqueLast4(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const last4 = phoneLast4(String(row.telNum ?? row.mobiles ?? ""));
    if (last4) {
      seen.add(last4);
    }
  }
  return [...seen].slice(0, 20);
}

function uniqueStrings(rows: Record<string, unknown>[], key: string): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).length > 0) {
      seen.add(String(value));
    }
  }
  return [...seen].slice(0, 20);
}

function matchById(
  rows: Record<string, unknown>[],
  requestId?: string,
): Record<string, unknown> | undefined {
  if (!requestId) {
    return undefined;
  }
  return rows.find((row) =>
    [row.requestId, row.UUID, row.CRQID, row.uuid, row.request_id].some(
      (id) => id !== undefined && String(id) === requestId,
    ),
  );
}

function matchByLast4Digits(
  rows: Record<string, unknown>[],
  last4?: string,
): Record<string, unknown> | undefined {
  if (!last4) {
    return undefined;
  }
  return rows.find((row) => phoneLast4(String(row.telNum ?? row.mobiles ?? "")) === last4);
}

async function fetchLogRows(url: string, authKey: string): Promise<{
  httpStatus: number;
  body: unknown;
  rows: Record<string, unknown>[];
}> {
  const dateQuery = `startDate=${ymdInKolkata(-1)}&endDate=${ymdInKolkata(0)}`;
  const response = await fetch(`${url}?${dateQuery}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authkey: authKey,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const body: unknown = await response.json().catch(() => null);
  return { httpStatus: response.status, body, rows: extractRows(body) };
}

export async function lookupMsg91OtpDelivery(input: {
  authKey: string;
  requestId?: string;
  last4?: string;
}): Promise<{
  httpStatus: number;
  rowCount: number;
  metadata?: unknown;
  bodyKeys: string[];
  otpLast4s: string[];
  matchByRequestId?: ReturnType<typeof safeRow>;
  matchByLast4?: ReturnType<typeof safeRow>;
  smsHttpStatus: number;
  smsRowCount: number;
  smsLast4s: string[];
  smsMatchByRequestId?: ReturnType<typeof safeRow>;
  smsMatchByLast4?: ReturnType<typeof safeRow>;
  otpFlowIds: string[];
  otpCampaignNames: string[];
  otpIsApiValues: string[];
}> {
  const otp = await fetchLogRows(OTP_LOGS_URL, input.authKey);
  const sms = await fetchLogRows(SMS_LOGS_URL, input.authKey);
  const otpRecord =
    otp.body !== null && typeof otp.body === "object" && !Array.isArray(otp.body)
      ? (otp.body as Record<string, unknown>)
      : null;
  const otpById = matchById(otp.rows, input.requestId);
  const otpByLast4 = matchByLast4Digits(otp.rows, input.last4);
  const smsById = matchById(sms.rows, input.requestId);
  const smsByLast4 = matchByLast4Digits(sms.rows, input.last4);

  return {
    httpStatus: otp.httpStatus,
    rowCount: otp.rows.length,
    metadata: otpRecord?.metadata,
    bodyKeys: collectJsonKeys(otp.body),
    otpLast4s: uniqueLast4(otp.rows),
    matchByRequestId: otpById ? safeRow(otpById) : undefined,
    matchByLast4: otpByLast4 ? safeRow(otpByLast4) : undefined,
    smsHttpStatus: sms.httpStatus,
    smsRowCount: sms.rows.length,
    smsLast4s: uniqueLast4(sms.rows),
    smsMatchByRequestId: smsById ? safeRow(smsById) : undefined,
    smsMatchByLast4: smsByLast4 ? safeRow(smsByLast4) : undefined,
    otpFlowIds: uniqueStrings(otp.rows, "flowID"),
    otpCampaignNames: uniqueStrings(otp.rows, "campaignName"),
    otpIsApiValues: uniqueStrings(otp.rows, "isApi"),
  };
}
