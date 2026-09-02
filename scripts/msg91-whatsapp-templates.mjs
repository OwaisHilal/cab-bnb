#!/usr/bin/env node
/**
 * MSG91 WhatsApp template setup helper.
 *
 * Reads templates/msg91/whatsapp-templates.json and prints dashboard copy-paste
 * specs. Optionally lists templates already on your MSG91 account.
 *
 * Usage:
 *   node scripts/msg91-whatsapp-templates.mjs
 *   node scripts/msg91-whatsapp-templates.mjs --list
 *   node scripts/msg91-whatsapp-templates.mjs --env
 *
 * Requires .env.local with MSG91_AUTH_KEY (+ MSG91_WHATSAPP_INTEGRATED_NUMBER for --list).
 * Never prints authkey values.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const CATALOG_PATH = resolve(process.cwd(), "templates/msg91/whatsapp-templates.json")
const ENV_PATH = resolve(process.cwd(), ".env.local")

const GET_TEMPLATES_URL =
  "https://control.msg91.com/api/v5/whatsapp/get-template-library/"

function loadEnvKeys(keys) {
  const picked = {}
  try {
    const raw = readFileSync(ENV_PATH, "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      if (keys.includes(key)) {
        picked[key] = trimmed.slice(eq + 1).trim()
      }
    }
  } catch {
    // .env.local optional for print-only mode
  }
  return picked
}

function loadCatalog() {
  return JSON.parse(readFileSync(CATALOG_PATH, "utf8"))
}

function printDivider(title) {
  console.info("")
  console.info("=".repeat(72))
  console.info(title)
  console.info("=".repeat(72))
}

function printDashboardTemplate(template, index) {
  console.info("")
  console.info(`${index + 1}. ${template.name}  [${template.category}]  priority ${template.priority}`)
  console.info(`   Send: ${template.sendMethod}`)
  console.info(`   Code: ${template.wiredInCode}`)
  console.info("")
  console.info("   BODY (paste in MSG91 dashboard):")
  console.info("   ---")
  for (const line of template.body.split("\n")) {
    console.info(`   ${line}`)
  }
  console.info("   ---")
  if (template.header) {
    console.info(`   HEADER: ${template.header.type} — sample ${template.header.sampleUrl}`)
  }
  if (template.footer) {
    console.info(`   FOOTER (max 60 chars): ${template.footer}`)
  }
  if (template.buttons?.length) {
    console.info(`   BUTTONS: ${template.buttons.map((b) => b.label ?? b.type).join(" · ")}`)
  } else {
    console.info("   BUTTONS: none")
  }
  if (template.sampleVariables && Object.keys(template.sampleVariables).length > 0) {
    console.info("   SAMPLE VARIABLES:")
    for (const [key, value] of Object.entries(template.sampleVariables)) {
      console.info(`     {{${key}}} → ${value}`)
    }
  }
  if (template.notes) {
    console.info(`   NOTE: ${template.notes}`)
  }
  printCreateApiHint(template)
  if (template.env) {
    console.info("   ENV (after Green approval):")
    for (const [key, value] of Object.entries(template.env)) {
      console.info(`     ${key}=${value}`)
    }
  }
}

function printSessionMessage(message, index) {
  console.info("")
  console.info(`${index + 1}. ${message.name}  [session interactive — NO dashboard template]`)
  console.info(`   Send: ${message.sendMethod ?? "session_interactive"}`)
  console.info(`   API: ${message.api ?? "POST …/whatsapp-outbound-message/"}`)
  console.info(`   Code: ${message.wiredInCode}`)
  console.info("")
  console.info("   BODY EXAMPLE:")
  console.info("   ---")
  for (const line of message.bodyExample.split("\n")) {
    console.info(`   ${line}`)
  }
  console.info("   ---")

  if (message.footer) {
    console.info(`   FOOTER: ${message.footer}`)
  }

  if (message.listRows?.length) {
    console.info(`   LIST BUTTON: ${message.listButton ?? "Choose"}`)
    console.info(`   LIST SECTION: ${message.listSectionTitle ?? "Options"}`)
    console.info("   LIST ROWS:")
    for (const row of message.listRows) {
      const desc = row.description ? ` — ${row.description}` : ""
      console.info(`     • ${row.title}${desc}  →  payload ${row.payload}`)
    }
  } else if (message.buttons?.length) {
    console.info("   BUTTONS:")
    for (const button of message.buttons) {
      console.info(`     • ${button.title}  →  payload ${button.payload}`)
    }
  } else {
    console.info("   BUTTONS: none")
  }

  if (message.notes) {
    console.info(`   NOTE: ${message.notes}`)
  }
}

function printCreateApiHint(template) {
  if (!template.createApi) return
  console.info(`   CREATE API: ${template.createApi.method} ${template.createApi.url}`)
  if (template.createApi.notes) {
    console.info(`   CREATE NOTE: ${template.createApi.notes}`)
  }
}

function printEnvBlock(catalog) {
  printDivider("Suggested .env.local block (fill namespaces after Green approval)")
  console.info("")
  console.info("# MSG91 WhatsApp — required for production sends")
  console.info("MSG91_AUTH_KEY=")
  console.info("MSG91_WHATSAPP_INTEGRATED_NUMBER=")
  console.info("")
  for (const template of catalog.dashboardTemplates) {
    if (!template.env) continue
    console.info(`# ${template.name}`)
    for (const [key, value] of Object.entries(template.env)) {
      console.info(`${key}=${value}`)
    }
    console.info("")
  }
}

async function listRemoteTemplates(authKey, integratedNumber) {
  const url = new URL(GET_TEMPLATES_URL)
  url.searchParams.set("number", integratedNumber.replace(/^\+/, ""))

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      authkey: authKey,
    },
  })

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    console.error(`MSG91 list templates failed (${response.status}):`, JSON.stringify(body))
    console.error("Create templates manually using the specs above.")
    return
  }

  printDivider("Templates on your MSG91 account")
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.templates)
        ? body.templates
        : null

  if (!rows || rows.length === 0) {
    console.info("No templates returned (or empty account). Use dashboard specs above to create them.")
    console.info("Raw response keys:", body && typeof body === "object" ? Object.keys(body).join(", ") : "—")
    return
  }

  for (const row of rows.slice(0, 50)) {
    const name = row.name ?? row.template_name ?? row.templateName ?? "?"
    const status = row.status ?? row.template_status ?? "?"
    const language = row.language ?? row.lang ?? "?"
    console.info(`  • ${name}  (${language})  status=${status}`)
  }
  if (rows.length > 50) {
    console.info(`  … and ${rows.length - 50} more`)
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const catalog = loadCatalog()

  printDivider("KMR BnB Cabs — MSG91 WhatsApp templates")
  console.info(`Dashboard: ${catalog.meta.dashboardPath}`)
  console.info(`Docs: ${catalog.meta.docs}`)
  console.info(`Language: ${catalog.meta.language}`)

  printDivider("A) Create these in MSG91 dashboard (Utility + Authentication)")
  for (const [index, template] of catalog.dashboardTemplates.entries()) {
    printDashboardTemplate(template, index)
  }

  printDivider("B) Session interactive messages (code sends these — no dashboard template)")
  console.info(
    "These use dynamic button payloads (BOOK_TOKEN::uuid, COMPLETE_PAYMENT::uuid).",
  )
  console.info("Already wired in lib/msg91/ + lib/whatsapp/sendOutbound.ts when MSG91 creds are set.")
  for (const [index, message] of catalog.sessionInteractiveMessages.entries()) {
    printSessionMessage(message, index)
  }

  if (catalog.deprecated?.length) {
    printDivider("Deprecated (do not create)")
    for (const item of catalog.deprecated) {
      console.info(`  • ${item}`)
    }
  }

  if (args.has("--env")) {
    printEnvBlock(catalog)
  }

  if (args.has("--list")) {
    const env = loadEnvKeys(["MSG91_AUTH_KEY", "MSG91_WHATSAPP_INTEGRATED_NUMBER"])
    if (!env.MSG91_AUTH_KEY || !env.MSG91_WHATSAPP_INTEGRATED_NUMBER) {
      console.error("")
      console.error("--list requires MSG91_AUTH_KEY and MSG91_WHATSAPP_INTEGRATED_NUMBER in .env.local")
      process.exit(1)
    }
    await listRemoteTemplates(env.MSG91_AUTH_KEY, env.MSG91_WHATSAPP_INTEGRATED_NUMBER)
  }

  printDivider("Next steps")
  console.info("1. Run: node scripts/msg91-whatsapp-templates.mjs --env  → copy env block")
  console.info("2. Create section A templates in MSG91 dashboard → wait for Green")
  console.info("3. Copy namespace from each template’s Code view into .env.local")
  console.info("4. Run: node scripts/msg91-whatsapp-templates.mjs --list  → verify on account")
  console.info("5. Demo mode unchanged — production uses MSG91 when DEMO_MODE=false + creds set")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
