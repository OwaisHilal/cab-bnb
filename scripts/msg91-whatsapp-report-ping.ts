/**
 * DEBUG (session fdcd5f): read-only lookup against MSG91's REAL WhatsApp
 * delivery report API (docs.msg91.com/whatsapp/whatsapp-logs) to see the
 * true delivery status of the diagnostic session-text send that our app
 * logged as "succeeded". Reads MSG91_AUTH_KEY from .env. Never prints the
 * authkey or full phone numbers (last4 only). Read-only GET, no sends.
 *
 * Usage: npx tsx scripts/msg91-whatsapp-report-ping.ts [--last4=8789]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WA_LOGS_URL = "https://control.msg91.com/api/v5/report/logs/wa";

function loadAuthKey(): string {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (key === "MSG91_AUTH_KEY") {
          const value = trimmed.slice(eq + 1).trim();
          if (value) return value;
        }
      }
    } catch {
      // try next file
    }
  }
  return "";
}

function ymdInKolkata(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function phoneLast4(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

function extractRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(
      (row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row),
    );
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return [];
  const record = body as Record<string, unknown>;
  for (const key of ["data", "logs", "records", "list", "result"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row),
      );
    }
  }
  return [];
}

function safeRow(row: Record<string, unknown>): Record<string, unknown> {
  const tel = String(row.telNum ?? row.mobiles ?? row.recipient_number ?? row.customerNumber ?? "");
  const { telNum: _t, mobiles: _m, recipient_number: _r, customerNumber: _c, ...rest } = row;
  return { ...rest, last4: phoneLast4(tel) };
}

async function main(): Promise<void> {
  const authKey = loadAuthKey();
  console.info("[wa report ping] env", { authKeySet: Boolean(authKey) });
  if (!authKey) {
    console.info("[wa report ping] skip — MSG91_AUTH_KEY is empty");
    return;
  }

  const last4Arg = process.argv.find((arg) => arg.startsWith("--last4="))?.slice("--last4=".length);

  const startDate = ymdInKolkata(-2);
  const endDate = ymdInKolkata(0);
  const url = `${WA_LOGS_URL}?startDate=${startDate}&endDate=${endDate}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", authkey: authKey },
    });
    const body: unknown = await response.json().catch(() => null);
    const rows = extractRows(body);
    console.info("[wa report ping] result", {
      httpStatus: response.status,
      rowCount: rows.length,
      bodyKeys:
        body !== null && typeof body === "object" && !Array.isArray(body)
          ? Object.keys(body as Record<string, unknown>)
          : undefined,
      rawBodyIfSmall: rows.length === 0 ? body : undefined,
    });

    if (last4Arg) {
      const matches = rows.filter((row) => {
        const tel = String(row.telNum ?? row.mobiles ?? row.recipient_number ?? row.customerNumber ?? "");
        return phoneLast4(tel) === last4Arg;
      });
      console.info("[wa report ping] matches for last4", {
        last4: last4Arg,
        matchCount: matches.length,
        matches: matches.slice(0, 10).map(safeRow),
      });
    } else {
      console.info("[wa report ping] sample rows", rows.slice(0, 5).map(safeRow));
    }
  } catch (error) {
    console.info("[wa report ping] fetch failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

void main();
