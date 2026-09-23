/**
 * Read-only: fetch MSG91 template status for one template name.
 * Usage: node scripts/msg91-check-template-status.mjs vendor_assign_driver_v2
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const TEMPLATE_NAME = process.argv[2] ?? "vendor_assign_driver_v2"

function loadEnv() {
  const picked = {}
  for (const file of [".env", ".env.local"]) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      picked[key] = value
    }
  }
  return picked
}

function pickRows(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === "object") {
    for (const key of ["data", "templates", "template", "result"]) {
      const value = body[key]
      if (Array.isArray(value)) return value
    }
    if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
      return [body.data]
    }
  }
  return []
}

async function main() {
  const env = loadEnv()
  const authKey = env.MSG91_AUTH_KEY?.trim()
  const integratedNumber = env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim()?.replace(/^\+/, "")

  if (!authKey || !integratedNumber) {
    console.error("Need MSG91_AUTH_KEY and MSG91_WHATSAPP_INTEGRATED_NUMBER in .env.local")
    process.exit(1)
  }

  const url = `https://control.msg91.com/api/v5/whatsapp/get-template-client/${integratedNumber}?template_name=${encodeURIComponent(TEMPLATE_NAME)}`

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json", authkey: authKey },
  })

  const body = await response.json().catch(() => null)
  const rows = pickRows(body)
  const match =
    rows.find((row) => {
      const name = String(row.name ?? row.template_name ?? row.templateName ?? "")
      return name === TEMPLATE_NAME
    }) ?? rows[0]

  console.info("[msg91 template status]", {
    templateName: TEMPLATE_NAME,
    httpStatus: response.status,
    rowCount: rows.length,
  })

  if (!match) {
    console.info("No matching row. Raw body keys:", body && typeof body === "object" ? Object.keys(body) : body)
    console.info(JSON.stringify(body, null, 2))
    process.exit(response.ok ? 0 : 1)
    return
  }

  const langRow = Array.isArray(match.languages) ? match.languages[0] : null
  const status =
    langRow?.status ??
    match.status ??
    match.template_status ??
    match.state ??
    "unknown"
  const id = langRow?.id ?? match.id ?? match.template_id ?? match.templateId
  const category = match.category ?? match.template_category ?? langRow?.category
  const language = langRow?.language ?? match.language ?? match.template_language ?? match.lang

  console.info("[msg91 template status] match", {
    id,
    name: match.name ?? match.template_name ?? TEMPLATE_NAME,
    status,
    category,
    language,
    rejectedReason:
      langRow?.rejection_reason ??
      match.rejected_reason ??
      match.reason ??
      match.rejection_reason ??
      undefined,
  })

  if (status === "unknown" && process.argv.includes("--verbose")) {
    console.info("[msg91 template status] raw row", JSON.stringify(match, null, 2))
  }
}

void main()
