import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

let cachedClient: SupabaseClient | null = null;

/**
 * Service-role Supabase client for Edge Functions. Mirrors the caching +
 * "server-only, bypasses RLS" contract of lib/supabase/server.ts, but reads
 * from Deno.env (Edge Function secrets, set via `supabase secrets set`)
 * instead of Next.js process.env — these are two separate secret stores.
 *
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into
 * every Edge Function's environment by the Supabase platform; they do not
 * need to be set manually via `supabase secrets set`.
 */
export function getSupabaseServiceRoleClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the Edge Function environment");
  }

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cachedClient;
}
