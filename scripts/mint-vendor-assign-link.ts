/**
 * Mint a signed vendor "Assign driver" URL — same token as the WhatsApp CTA,
 * without sending WhatsApp or paying token.
 *
 * Usage:
 *   npm run mint:vendor-assign-link -- --booking-id=<uuid>
 *   npm run mint:vendor-assign-link -- --latest
 *   npm run mint:vendor-assign-link -- --booking-id=<uuid> --env=local
 *
 * Requires VENDOR_ASSIGN_SECRET + Supabase URL/key in .env / .env.local
 * (same as the Next app). For local UI testing, run `npm run dev` and pass
 * --env=local (or set NEXT_PUBLIC_APP_BASE_URL=http://localhost:3000).
 */
import { createHmac } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const DEFAULT_PRODUCTION_BASE = "https://cab-bnb.vercel.app"
const LOCAL_BASE = "http://localhost:3000"
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000

const ATTACHED_OR_LATER = new Set([
  "driver_attached",
  "ready_for_pickup",
  "in_trip",
  "completed",
])

interface DotEnv {
  [key: string]: string
}

function loadDotEnvFile(path: string): DotEnv {
  if (!existsSync(path)) return {}
  const values: DotEnv = {}
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
    values[key] = value
  }
  return values
}

function loadEnv(): DotEnv {
  const base = loadDotEnvFile(resolve(process.cwd(), ".env"))
  const local = loadDotEnvFile(resolve(process.cwd(), ".env.local"))
  return { ...base, ...local }
}

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`
  const arg = process.argv.find((value) => value.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/** Must stay in sync with lib/whatsapp/vendorAssignToken.ts */
function signVendorAssignToken(secret: string, bookingId: string, vendorId: string, ttlMs = DEFAULT_TTL_MS): string {
  const payload = {
    bookingId,
    vendorId,
    exp: Date.now() + ttlMs,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac("sha256", secret).update(payloadB64).digest("base64url")
  return `${payloadB64}.${signature}`
}

function baseUrl(env: DotEnv): string {
  if (readFlag("env") === "local") return LOCAL_BASE
  const override = readFlag("base-url") ?? env.NEXT_PUBLIC_APP_BASE_URL?.trim()
  return (override || DEFAULT_PRODUCTION_BASE).replace(/\/+$/, "")
}

function isAssignable(status: string, paymentStatus: string): boolean {
  if (paymentStatus === "fully_paid") return false
  return !ATTACHED_OR_LATER.has(status)
}

async function supabaseGet(path: string, env: DotEnv): Promise<unknown> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env / .env.local")
  }
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

async function resolveBooking(env: DotEnv): Promise<{ id: string; vendor_id: string; status: string; payment_status: string; booking_ref: string | null }> {
  const bookingId = readFlag("booking-id")
  if (bookingId) {
    const rows = (await supabaseGet(
      `bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,vendor_id,status,payment_status,booking_ref&limit=1`,
      env,
    )) as Array<{ id: string; vendor_id: string; status: string; payment_status: string; booking_ref: string | null }>
    const row = rows[0]
    if (!row) throw new Error(`No booking found for id ${bookingId}`)
    return row
  }

  if (!hasFlag("latest")) {
    throw new Error("Pass --booking-id=<uuid> or --latest to pick the newest assignable booking")
  }

  const rows = (await supabaseGet(
    "bookings?select=id,vendor_id,status,payment_status,booking_ref&order=created_at.desc&limit=30",
    env,
  )) as Array<{ id: string; vendor_id: string; status: string; payment_status: string; booking_ref: string | null }>

  const assignable = rows.find((row) => isAssignable(row.status, row.payment_status))
  if (!assignable) {
    throw new Error("No assignable booking in the last 30 rows (need status before driver_attached and payment_status != fully_paid)")
  }
  return assignable
}

async function main(): Promise<void> {
  const env = loadEnv()
  const secret = env.VENDOR_ASSIGN_SECRET?.trim()
  if (!secret) {
    console.error("[mint vendor assign link] VENDOR_ASSIGN_SECRET is not set in .env / .env.local")
    process.exitCode = 1
    return
  }

  const booking = await resolveBooking(env)
  const vendorId = readFlag("vendor-id") ?? booking.vendor_id

  if (!isAssignable(booking.status, booking.payment_status)) {
    console.warn(
      "[mint vendor assign link] WARNING: this booking may show 'Driver already assigned' on the page:",
      { status: booking.status, payment_status: booking.payment_status },
    )
  }

  const token = signVendorAssignToken(secret, booking.id, vendorId)
  const url = `${baseUrl(env)}/vendor/assign-driver?token=${encodeURIComponent(token)}`

  console.info("[mint vendor assign link] booking", {
    id: booking.id,
    booking_ref: booking.booking_ref,
    vendor_id: vendorId,
    status: booking.status,
    payment_status: booking.payment_status,
  })
  console.info("\nOpen in any browser (no WhatsApp needed):\n")
  console.info(url)
  console.info("")
}

void main().catch((error) => {
  console.error("[mint vendor assign link]", error instanceof Error ? error.message : error)
  process.exitCode = 1
})
