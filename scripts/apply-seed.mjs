/**
 * Applies supabase/seed.sql fixture rows via the Supabase REST API when the
 * Supabase CLI is unavailable. Safe to re-run (upserts vendors, upserts bands).
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"

function loadEnvFile(path) {
  const env = {}
  const raw = readFileSync(path, "utf8")

  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }

  return env
}

const vendors = [
  {
    id: "11111111-1111-1111-1111-111111111101",
    business_name: "Nova Cabs",
    slug: "nova-cabs",
    onboarding_stage: "whatsapp_only",
    status: "active",
    primary_city: "Srinagar",
    coverage_cities: ["Srinagar", "Gulmarg", "Pahalgam"],
    whatsapp_number: "+919999900001",
  },
  {
    id: "11111111-1111-1111-1111-111111111102",
    business_name: "Ola Cabs",
    slug: "ola-cabs",
    onboarding_stage: "whatsapp_only",
    status: "active",
    primary_city: "Srinagar",
    coverage_cities: ["Srinagar", "Sonamarg"],
    whatsapp_number: "+919999900002",
  },
  {
    id: "11111111-1111-1111-1111-111111111103",
    business_name: "Aala Cabs",
    slug: "aala-cabs",
    onboarding_stage: "whatsapp_only",
    status: "active",
    primary_city: "Srinagar",
    coverage_cities: ["Gulmarg", "Srinagar", "Yusmarg"],
    whatsapp_number: "+919999900003",
  },
  {
    id: "11111111-1111-1111-1111-111111111104",
    business_name: "Uber",
    slug: "uber",
    onboarding_stage: "whatsapp_only",
    status: "active",
    primary_city: "Srinagar",
    coverage_cities: ["Srinagar", "Gulmarg", "Pahalgam", "Sonamarg"],
    whatsapp_number: "+919999900004",
  },
]

const vendorRateBands = [
  ["22222222-2222-2222-2222-222222222201", "11111111-1111-1111-1111-111111111101", 1, "Dzire", 1, 8, 1, 14, 7000, 9000],
  ["22222222-2222-2222-2222-222222222202", "11111111-1111-1111-1111-111111111101", 2, "Ertiga", 1, 7, 1, 14, 9000, 11000],
  ["22222222-2222-2222-2222-222222222203", "11111111-1111-1111-1111-111111111101", 3, "Tempo Traveller", 5, 20, 1, 14, 15000, 18000],
  ["22222222-2222-2222-2222-222222222204", "11111111-1111-1111-1111-111111111102", 1, "Etios", 1, 8, 1, 14, 7200, 9200],
  ["22222222-2222-2222-2222-222222222205", "11111111-1111-1111-1111-111111111102", 2, "Innova", 1, 7, 1, 14, 8800, 10800],
  ["22222222-2222-2222-2222-222222222206", "11111111-1111-1111-1111-111111111102", 3, "Tempo Traveller", 5, 20, 1, 14, 14500, 17500],
  ["22222222-2222-2222-2222-222222222207", "11111111-1111-1111-1111-111111111103", 1, "Amaze", 1, 8, 1, 14, 6800, 8800],
  ["22222222-2222-2222-2222-222222222208", "11111111-1111-1111-1111-111111111103", 2, "Innova Crysta", 1, 7, 1, 14, 9200, 11200],
  ["22222222-2222-2222-2222-222222222209", "11111111-1111-1111-1111-111111111103", 3, "Tempo Traveller", 5, 20, 1, 14, 15200, 18200],
  ["22222222-2222-2222-2222-222222222210", "11111111-1111-1111-1111-111111111104", 1, "Swift Dzire", 1, 8, 1, 14, 7100, 9100],
  ["22222222-2222-2222-2222-222222222211", "11111111-1111-1111-1111-111111111104", 2, "Ertiga", 1, 7, 1, 14, 9100, 11100],
  ["22222222-2222-2222-2222-222222222212", "11111111-1111-1111-1111-111111111104", 3, "Tempo Traveller", 5, 20, 1, 14, 14800, 17800],
].map(
  ([
    id,
    vendor_id,
    vehicle_type_id,
    vehicle_model,
    pax_min,
    pax_max,
    trip_days_min,
    trip_days_max,
    min_quote,
    max_quote,
  ]) => ({
    id,
    vendor_id,
    vehicle_type_id,
    vehicle_model,
    pax_min,
    pax_max,
    trip_days_min,
    trip_days_max,
    season_quarter: "ALL_YEAR",
    min_quote,
    max_quote,
  }),
)

const envPath = resolve(process.cwd(), ".env")
const env = loadEnvFile(envPath)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !secretKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env")
  process.exit(1)
}

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const vendorResult = await supabase.from("vendors").upsert(vendors, { onConflict: "id" })
if (vendorResult.error) {
  console.error("Vendor seed failed:", vendorResult.error.message)
  process.exit(1)
}

const bandResult = await supabase.from("vendor_rate_bands").upsert(vendorRateBands, { onConflict: "id" })
if (bandResult.error) {
  console.error("Rate band seed failed:", bandResult.error.message)
  process.exit(1)
}

const { data: seededVendors, error: verifyError } = await supabase
  .from("vendors")
  .select("business_name")
  .in(
    "id",
    vendors.map((vendor) => vendor.id),
  )
  .order("business_name")

if (verifyError) {
  console.error("Seed verify failed:", verifyError.message)
  process.exit(1)
}

console.info("Demo seed applied successfully:")
for (const row of seededVendors ?? []) {
  console.info(`  - ${row.business_name}`)
}
