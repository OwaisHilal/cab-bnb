/**
 * Manual smoke test for the Cashfree Payment Links workaround
 * (docs/cashfree-payment-links-workaround.md). Creates ONE real Cashfree
 * Payment Link directly against production Cashfree
 * (CASHFREE_APP_ID / CASHFREE_SECRET_KEY from .env.local or .env — a
 * `cfsk_ma_prod...` secret is a PRODUCTION key). Run this once before
 * relying on the automated flow in front of real customers.
 *
 * This DOES NOT charge anyone automatically — it only creates the link and
 * prints the URL. Paying it (however small the amount) moves real money.
 * There is no Cashfree sandbox configured for this merchant.
 *
 * Usage:
 *   npx tsx scripts/cashfree-payment-link-smoke-test.ts [--amount=1] [--phone=917889418789]
 *
 * After running:
 *   1. Open the printed link_url and pay it yourself (defaults to ₹1, not
 *      the production ₹99, to keep the test cheap — pass --amount=99 to
 *      test the exact production amount instead).
 *   2. If CASHFREE_WEBHOOK_NOTIFY_URL is set to a reachable HTTPS URL
 *      (tunnel or deployed host), watch that app's logs for
 *      "[cashfree webhook] ..." lines confirming the signature verified and
 *      the PAID event was processed.
 *   3. This script also polls GET /pg/links/{link_id} a few times after
 *      creation so you can see link_status flip to PAID without needing
 *      the webhook — that only proves the Cashfree API side, not the
 *      webhook delivery, so still check step 2 separately.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CASHFREE_BASE_URL = "https://api.cashfree.com";
const CASHFREE_PAYMENT_LINKS_PATH = "/pg/links";
const DEFAULT_API_VERSION = "2025-01-01";

function loadEnvValue(key: string): string {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const foundKey = trimmed.slice(0, eq).trim();
        if (foundKey === key) {
          const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, "");
          if (value) return value;
        }
      }
    } catch {
      // try next file
    }
  }
  return process.env[key]?.trim() ?? "";
}

function readArg(name: string, fallback: string): string {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

function headers(appId: string, secretKey: string, apiVersion: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-client-id": appId,
    "x-client-secret": secretKey,
    "x-api-version": apiVersion,
  };
}

async function main(): Promise<void> {
  const appId = loadEnvValue("CASHFREE_APP_ID");
  const secretKey = loadEnvValue("CASHFREE_SECRET_KEY");
  const apiVersion = loadEnvValue("CASHFREE_API_VERSION") || DEFAULT_API_VERSION;
  const notifyUrl = loadEnvValue("CASHFREE_WEBHOOK_NOTIFY_URL");

  console.info("[cashfree smoke test] env", {
    appIdSet: Boolean(appId),
    secretKeySet: Boolean(secretKey),
    apiVersion,
    notifyUrlSet: Boolean(notifyUrl),
  });

  if (!appId || !secretKey) {
    console.info("[cashfree smoke test] skip — CASHFREE_APP_ID/CASHFREE_SECRET_KEY are empty");
    return;
  }

  const amount = Number(readArg("amount", "1"));
  const phone = readArg("phone", "9999999999");
  const linkId = `smoke_${Date.now()}`;

  const body: Record<string, unknown> = {
    link_id: linkId,
    link_amount: amount,
    link_currency: "INR",
    link_purpose: "Cashfree Payment Links smoke test",
    link_partial_payments: false,
    customer_details: { customer_phone: phone },
    link_notify: { send_sms: false, send_email: false },
  };
  if (notifyUrl) body.link_meta = { notify_url: notifyUrl };

  console.info("[cashfree smoke test] creating link", { linkId, amount, notifyUrlSet: Boolean(notifyUrl) });

  const createResponse = await fetch(`${CASHFREE_BASE_URL}${CASHFREE_PAYMENT_LINKS_PATH}`, {
    method: "POST",
    headers: headers(appId, secretKey, apiVersion),
    body: JSON.stringify(body),
  });
  const createBody: unknown = await createResponse.json().catch(() => null);

  console.info("[cashfree smoke test] create result", {
    httpStatus: createResponse.status,
    ok: createResponse.ok,
    body: createBody,
  });

  if (!createResponse.ok) return;

  const linkUrl = (createBody as Record<string, unknown> | null)?.link_url as string | undefined;
  if (!linkUrl) {
    console.info("[cashfree smoke test] no link_url in response — stopping");
    return;
  }

  console.info("[cashfree smoke test] pay this link now to complete the test", { linkUrl });

  const pollAttempts = 12; // ~2 minutes at 10s apart
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    await new Promise((r) => setTimeout(r, 10_000));
    const getResponse = await fetch(
      `${CASHFREE_BASE_URL}${CASHFREE_PAYMENT_LINKS_PATH}/${encodeURIComponent(linkId)}`,
      { method: "GET", headers: headers(appId, secretKey, apiVersion) },
    );
    const getBody: unknown = await getResponse.json().catch(() => null);
    const linkStatus = (getBody as Record<string, unknown> | null)?.link_status as string | undefined;
    console.info("[cashfree smoke test] poll", { attempt, linkStatus });
    if (linkStatus && linkStatus !== "ACTIVE") {
      console.info("[cashfree smoke test] link left ACTIVE — check the target app's logs for", {
        expectedLog: "[cashfree webhook] ...",
        finalStatus: linkStatus,
      });
      return;
    }
  }

  console.info("[cashfree smoke test] timed out waiting for payment — pay the link and re-run, or check manually");
}

void main();
