#!/usr/bin/env node
// Phase 3 final pass — static, no-dependency verification. Run directly
// via `node scripts/verify-phase3-final.mjs`. Does not require live
// WhatsApp credentials, a running Supabase project, or the Deno CLI —
// it only asserts that the source files contain the wiring the plan
// requires, since Edge Function runtime checks stay blocked without a
// local Deno install.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];

function readOrFail(relativePath) {
  const fullPath = join(rootDir, relativePath);
  try {
    return readFileSync(fullPath, "utf8");
  } catch {
    failures.push(`Missing file: ${relativePath}`);
    return "";
  }
}

function check(label, condition) {
  if (!condition) failures.push(label);
}

const vercelJson = readOrFail("vercel.json");
for (const cronPath of [
  "/api/cron/dispatch-jobs",
  "/api/cron/dispatch-lifecycle-events",
  "/api/cron/expire-stale-quotes",
  "/api/cron/vendor-reply-timeouts",
]) {
  check(`vercel.json is missing cron path ${cronPath}`, vercelJson.includes(cronPath));
}

const jobQueueWorker = readOrFail("supabase/functions/job-queue-worker/index.ts");
for (const jobType of ["ops_alert", "send_quotes", "compute_negotiation", "finalize_booking", "vendor_reply_timeouts"]) {
  check(
    `job-queue-worker/index.ts does not register job type "${jobType}"`,
    jobQueueWorker.includes(`${jobType}:`) || jobQueueWorker.includes(`"${jobType}"`),
  );
}

const parseWebhookPayload = readOrFail("lib/whatsapp/webhook/parseWebhookPayload.ts");
check(
  "parseWebhookPayload.ts does not handle statuses[] events",
  parseWebhookPayload.includes("parseWebhookStatuses") && parseWebhookPayload.includes(".statuses"),
);

const webhookRoute = readOrFail("app/api/whatsapp/webhook/route.ts");
check(
  "app/api/whatsapp/webhook/route.ts does not call parseWebhookStatuses",
  webhookRoute.includes("parseWebhookStatuses"),
);
check(
  "app/api/whatsapp/webhook/route.ts does not mark quote_snapshots viewed",
  webhookRoute.includes("quote_snapshots") && webhookRoute.includes("viewed"),
);

const sendConfirmationCard = readOrFail("supabase/functions/_shared/handlers/sendConfirmationCard.ts");
check(
  "sendConfirmationCard.ts does not reference CONFIRMATION_CARD_IMAGE_URL env keys",
  sendConfirmationCard.includes("CONFIRMATION_CARD_IMAGE_URL"),
);

const vendorReplyTimeouts = readOrFail("supabase/functions/_shared/handlers/vendorReplyTimeouts.ts");
check(
  "vendorReplyTimeouts.ts does not use VENDOR_DRIVER_DETAIL_SLA_MINUTES",
  vendorReplyTimeouts.includes("VENDOR_DRIVER_DETAIL_SLA_MINUTES"),
);
check(
  "vendorReplyTimeouts.ts does not set no_response_exception",
  vendorReplyTimeouts.includes("no_response_exception"),
);

const opsAlert = readOrFail("supabase/functions/_shared/handlers/opsAlert.ts");
check(
  "opsAlert.ts does not read OPS_ALERT_WEBHOOK_URL",
  opsAlert.includes("OPS_ALERT_WEBHOOK_URL"),
);

const cronRoute = readOrFail("app/api/cron/vendor-reply-timeouts/route.ts");
check(
  "app/api/cron/vendor-reply-timeouts/route.ts does not invoke the vendor-reply-timeouts Edge Function",
  cronRoute.includes("vendor-reply-timeouts") && cronRoute.includes("CRON_SECRET"),
);

if (failures.length > 0) {
  console.error("Phase 3 final pass verification FAILED:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("Phase 3 final pass verification passed.");
