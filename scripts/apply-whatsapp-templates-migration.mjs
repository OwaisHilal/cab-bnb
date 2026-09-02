/**
 * Apply whatsapp_message_templates migration without `supabase login`.
 *
 * Needs your Supabase **database password** (not the publishable/secret API keys):
 * Dashboard → Project Settings → Database → Database password
 *
 * Add to .env:
 *   SUPABASE_DB_PASSWORD=your-db-password
 *
 * Or set a full connection string:
 *   SUPABASE_DB_URL=postgresql://postgres.[ref]:[password]@...pooler.supabase.com:5432/postgres
 *
 * Usage:
 *   npm run db:templates
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")
const migrationPath = resolve(
  root,
  "supabase/migrations/20260814000100_0012_whatsapp_message_templates.sql",
)

function loadEnvFile(path) {
  const env = {}
  try {
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
  } catch {
    // .env optional if vars exported in shell
  }
  return env
}

function projectRefFromUrl(url) {
  const match = url?.match(/https:\/\/([^.]+)\.supabase\.co/)
  return match?.[1] ?? null
}

function buildPoolerUrl(ref, password) {
  const encoded = encodeURIComponent(password)
  return `postgresql://postgres.${ref}:${encoded}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`
}

function runPsql(dbUrl) {
  const sql = readFileSync(migrationPath, "utf8")
  const result = spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", migrationPath], {
    stdio: "inherit",
    env: process.env,
  })
  if (result.status === 0) {
    console.log("\n✓ Migration applied via psql")
    console.log(`  Table: whatsapp_message_templates (see ${migrationPath})`)
    return true
  }
  if (result.error?.code === "ENOENT") {
    return false
  }
  process.exit(result.status ?? 1)
}

function runSupabasePush(password) {
  console.log("Applying pending migrations with supabase db push --linked …")
  const result = spawnSync(
    "npx",
    ["supabase", "db", "push", "--linked", "--password", password],
    { cwd: root, stdio: "inherit", env: process.env },
  )
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
  console.log("\n✓ Migrations pushed")
}

function verifyTemplates() {
  const env = {
    ...loadEnvFile(resolve(root, ".env")),
    ...loadEnvFile(resolve(root, ".env.local")),
    ...process.env,
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log("\n(Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in .env to auto-verify)")
    return
  }

  return import("@supabase/supabase-js").then(({ createClient }) => {
    const sb = createClient(url, key)
    return sb
      .from("whatsapp_message_templates")
      .select("template_key", { count: "exact", head: true })
      .then(({ count, error }) => {
        if (error) {
          console.warn("\nVerify: table not visible yet —", error.message)
          console.warn("PostgREST schema cache can take ~1 min after DDL.")
          return
        }
        console.log(`\nVerify: ${count ?? 0} rows in whatsapp_message_templates`)
      })
  })
}

const env = {
  ...loadEnvFile(resolve(root, ".env")),
  ...loadEnvFile(resolve(root, ".env.local")),
  ...process.env,
}

const dbUrl = env.SUPABASE_DB_URL ?? env.DATABASE_URL
const password = env.SUPABASE_DB_PASSWORD
const ref = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL)

if (!dbUrl && !password) {
  console.error(`
Missing database credentials.

Add ONE of these to .env (from Supabase Dashboard → Settings → Database):

  SUPABASE_DB_PASSWORD=your-database-password

  # or full URL:
  SUPABASE_DB_URL=postgresql://postgres.[ref]:[password]@...pooler.supabase.com:5432/postgres

Then run: npm run db:templates

Other options without this script:
  • Dashboard SQL editor — paste ${migrationPath}
  • npx supabase db push --linked --password YOUR_DB_PASSWORD
`)
  process.exit(1)
}

const resolvedUrl = dbUrl ?? (ref ? buildPoolerUrl(ref, password) : null)
if (!resolvedUrl) {
  console.error("Could not build DB URL — set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_DB_URL")
  process.exit(1)
}

console.log("Applying whatsapp_message_templates migration …\n")

if (runPsql(resolvedUrl) === false) {
  if (!password) {
    console.error("psql not found and SUPABASE_DB_PASSWORD not set for supabase db push fallback")
    process.exit(1)
  }
  runSupabasePush(password)
}

await verifyTemplates()
