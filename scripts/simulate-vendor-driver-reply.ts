/**
 * npm run simulate:vendor-reply
 * # Same thing, explicit
npm run simulate:vendor-reply

# Against your local dev server instead of production
npx tsx scripts/simulate-vendor-driver-reply.ts --env=local

# Different vendor / driver
npx tsx scripts/simulate-vendor-driver-reply.ts --customer=919999900001 --driver-name="Bilal Ahmed" --driver-phone=9876500001

# Send a bare-phone reply instead of the full DRIVER: line
npx tsx scripts/simulate-vendor-driver-reply.ts --text="9876500003"

# Against a Vercel preview URL
npx tsx scripts/simulate-vendor-driver-reply.ts --url=https://cab-bnb-git-my-branch.vercel.app/api/whatsapp/webhook
 * Simulate a vendor's inbound `DRIVER: <name> | <phone> | <plate> | <model>`
 * WhatsApp reply by POSTing directly to app/api/whatsapp/webhook/route.ts —
 * the same code path a real MSG91 inbound webhook hits. Useful because the
 * seeded vendors (supabase/seed.sql) have fake `whatsapp_number` values, so
 * there's no real phone to reply from. Matching happens purely on phone
 * number in the DB, so this works against either production or a local
 * `next dev` server without needing real WhatsApp access.
 *
 * Reads MSG91_WEBHOOK_SECRET and MSG91_WHATSAPP_INTEGRATED_NUMBER from
 * .env (falling back to .env.local if present, mirroring Next.js's own
 * env precedence) — never hardcode the secret in this file or in a shell
 * command.
 *
 * Usage:
 *   npx tsx scripts/simulate-vendor-driver-reply.ts
 *   npx tsx scripts/simulate-vendor-driver-reply.ts --env=local
 *   npx tsx scripts/simulate-vendor-driver-reply.ts --customer=919999900001 --driver-name="Bilal Ahmed" --driver-phone=9876500001 --vehicle-number=JK01AB1234 --vehicle-model="Swift Dzire"
 *   npx tsx scripts/simulate-vendor-driver-reply.ts --text="9876500003"   # bare-phone reply instead of full DRIVER: line
 *   npx tsx scripts/simulate-vendor-driver-reply.ts --url=https://cab-bnb-git-my-branch.vercel.app/api/whatsapp/webhook
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const PRODUCTION_URL = "https://cab-bnb.vercel.app/api/whatsapp/webhook";
const LOCAL_URL = "http://localhost:3000/api/whatsapp/webhook";

// Aala Cabs — supabase/seed.sql — and its demo driver from
// docs/whatsapp-booking-flow.md's DEMO_VENDOR_DRIVERS table. Defaults
// exist purely so the script is runnable with zero flags; override any of
// them per-call.
const DEFAULT_CUSTOMER_NUMBER = "919999900003";
const DEFAULT_DRIVER_NAME = "Imran Dar";
const DEFAULT_DRIVER_PHONE = "9876500003";
const DEFAULT_VEHICLE_NUMBER = "JK01AB1234";
const DEFAULT_VEHICLE_MODEL = "Swift Dzire";

interface DotEnv {
  [key: string]: string;
}

function loadDotEnvFile(path: string): DotEnv {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const values: DotEnv = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Mirrors Next.js precedence: .env first, .env.local overrides. */
function loadEnv(): DotEnv {
  const base = loadDotEnvFile(resolve(process.cwd(), ".env"));
  const local = loadDotEnvFile(resolve(process.cwd(), ".env.local"));
  return { ...base, ...local };
}

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const env = loadEnv();

  const secret = env.MSG91_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[simulate vendor reply] MSG91_WEBHOOK_SECRET is not set in .env — cannot sign the webhook call.");
    process.exitCode = 1;
    return;
  }

  const envFlag = readFlag("env"); // "production" | "local"
  const url =
    readFlag("url") ??
    (envFlag === "local" ? LOCAL_URL : PRODUCTION_URL);

  const customerNumber = readFlag("customer") ?? DEFAULT_CUSTOMER_NUMBER;
  const integratedNumber =
    readFlag("integrated") ?? env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim() ?? "919103210746";

  const rawTextOverride = readFlag("text");
  const text =
    rawTextOverride ??
    `DRIVER: ${readFlag("driver-name") ?? DEFAULT_DRIVER_NAME} | ${
      readFlag("driver-phone") ?? DEFAULT_DRIVER_PHONE
    } | ${readFlag("vehicle-number") ?? DEFAULT_VEHICLE_NUMBER} | ${
      readFlag("vehicle-model") ?? DEFAULT_VEHICLE_MODEL
    }`;

  const uuid = randomUUID();
  const body = { customerNumber, integratedNumber, uuid, text };

  console.info("[simulate vendor reply] sending", { url, customerNumber, integratedNumber, uuid, text });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-msg91-webhook-secret": secret,
    },
    body: JSON.stringify(body),
  });

  const responseBody: unknown = await response.json().catch(() => null);
  console.info("[simulate vendor reply] response", { status: response.status, body: responseBody });

  if (!response.ok) {
    process.exitCode = 1;
  }
}

void main();
