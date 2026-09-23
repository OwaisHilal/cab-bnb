/**
 * Create the `vendor_assign_driver_v3` WhatsApp Utility template on MSG91
 * via their real create-template API — no manual dashboard work.
 *
 * v3 only simplifies the trailing CTA sentence (drops the long optional
 * `DRIVER: <name> | ...` free-text line); the 9 booking-summary variables
 * and the "Assign driver" URL button are unchanged from v2. See
 * lib/whatsapp/vendorAssignDriverCreateTemplateV3.ts.
 *
 * Creating v3 here does NOT switch live traffic — vendor_assign_driver_v2
 * stays the default in lib/whatsapp/templateEnv.ts until Meta/MSG91
 * approves v3 and the template-v3-switch step flips it over.
 *
 * Default (no flags): builds the request body and only PRINTS it, so it
 * can be reviewed against the WhatsApp Business Platform docs shape
 * before anything is sent. Nothing is sent to MSG91 in this mode.
 *
 * --live: actually POSTs the same body to
 * https://api.msg91.com/api/v5/whatsapp/client-panel-template/ and prints
 * MSG91's raw response (status + body) so acceptance or a rejection
 * reason is visible immediately.
 *
 * Reads MSG91_AUTH_KEY and MSG91_WHATSAPP_INTEGRATED_NUMBER from .env,
 * falling back to .env.local (mirrors Next.js's own env precedence, same
 * pattern as scripts/msg91-create-vendor-assign-driver-v2.ts). The
 * authkey is never logged.
 *
 * Usage:
 *   npm run msg91:create-vendor-assign-v3            # dry-run, prints JSON only
 *   npm run msg91:create-vendor-assign-v3 -- --live  # actually creates it on MSG91
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { buildVendorAssignDriverV3CreateApiBody } from "../lib/whatsapp/vendorAssignDriverCreateTemplateV3"

const CREATE_TEMPLATE_URL = "https://api.msg91.com/api/v5/whatsapp/client-panel-template/"

// Same fabricated-but-realistic sample token already used for v2's create
// script — demonstrates the dynamic URL suffix shape for Meta's review
// without needing VENDOR_ASSIGN_SECRET loaded here.
const SAMPLE_BUTTON_URL_TOKEN =
  "eyJib29raW5nSWQiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJ2ZW5kb3JJZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiIsImV4cCI6MTc1ODUyMzIwMDAwMH0.k8F3n2QpZ7xT1vM9wL4rY6bC0dE5fG2h"

interface DotEnv {
  [key: string]: string
}

function loadDotEnvFile(path: string): DotEnv {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, "utf8")
  const values: DotEnv = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

/** Mirrors Next.js precedence: .env first, .env.local overrides. */
function loadEnv(): DotEnv {
  const base = loadDotEnvFile(resolve(process.cwd(), ".env"))
  const local = loadDotEnvFile(resolve(process.cwd(), ".env.local"))
  return { ...base, ...local }
}

async function main(): Promise<void> {
  const env = loadEnv()
  const isLive = process.argv.includes("--live")

  const authKey = env.MSG91_AUTH_KEY?.trim()
  const integratedNumber = env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim()

  console.info("[create vendor_assign_driver_v3] env", {
    authKeySet: Boolean(authKey),
    integratedNumberSet: Boolean(integratedNumber),
    mode: isLive ? "LIVE — will POST to MSG91" : "dry-run — print only",
  })

  if (!integratedNumber) {
    console.error("[create vendor_assign_driver_v3] MSG91_WHATSAPP_INTEGRATED_NUMBER is not set — cannot build the request body.")
    process.exitCode = 1
    return
  }

  const body = buildVendorAssignDriverV3CreateApiBody(integratedNumber, SAMPLE_BUTTON_URL_TOKEN)

  console.info("[create vendor_assign_driver_v3] request body")
  console.info(JSON.stringify(body, null, 2))

  if (!isLive) {
    console.info("[create vendor_assign_driver_v3] dry-run only — nothing was sent. Re-run with --live to create it on MSG91.")
    console.info(
      "[create vendor_assign_driver_v3] NOTE: creating this template does not switch live traffic. " +
        "vendor_assign_driver_v2 stays the default until it's approved — see the template-v3-switch step.",
    )
    return
  }

  if (!authKey) {
    console.error("[create vendor_assign_driver_v3] --live requires MSG91_AUTH_KEY to be set.")
    process.exitCode = 1
    return
  }

  try {
    const response = await fetch(CREATE_TEMPLATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authkey: authKey },
      body: JSON.stringify(body),
    })
    const responseBody: unknown = await response.json().catch(() => null)
    console.info("[create vendor_assign_driver_v3] MSG91 response", {
      httpStatus: response.status,
      ok: response.ok,
      body: responseBody,
    })
    if (!response.ok) {
      process.exitCode = 1
    } else {
      console.info(
        "[create vendor_assign_driver_v3] Created. Traffic is still on vendor_assign_driver_v2 — " +
          "run scripts/msg91-check-template-status.mjs vendor_assign_driver_v3 to poll approval, " +
          "then run the template-v3-switch step once it's APPROVED.",
      )
    }
  } catch (error) {
    console.error("[create vendor_assign_driver_v3] request failed", {
      error: error instanceof Error ? error.message : "unknown",
    })
    process.exitCode = 1
  }
}

void main()
