import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

/**
 * Publishable-key Supabase client, safe to use in browser code. Subject to
 * Row Level Security — use `lib/supabase/server.ts` for privileged operations.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer the new publishable key (sb_publishable_...); fall back to the
  // legacy anon JWT key for envs not yet migrated. See
  // https://supabase.com/docs/guides/getting-started/api-keys
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY). Copy .env.example to .env.local and fill in your Supabase project credentials.",
    );
  }

  cachedClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
    },
  });

  return cachedClient;
}
