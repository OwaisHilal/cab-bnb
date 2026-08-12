import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill in your Supabase project credentials.`,
    );
  }
  return value;
}

/**
 * Service-role Supabase client. Server-only (guarded by the `server-only`
 * package): this key bypasses Row Level Security, so it must never be
 * imported from a client component, route handler that streams to the
 * browser, or any code path bundled for the client.
 *
 * Prefers the new secret key (sb_secret_...); falls back to the legacy
 * service_role JWT key for envs not yet migrated. See
 * https://supabase.com/docs/guides/getting-started/api-keys
 *
 * Per Checklist Phase 0, all privileged reads/writes (rate-band matching,
 * booking locks, quote snapshots) go through this client from Route Handlers
 * and Edge Functions only.
 */
export function getSupabaseServiceRoleClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ??
    readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  cachedClient = createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}
