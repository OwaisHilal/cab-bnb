import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleExpireStaleQuotes } from "../_shared/handlers/expireStaleQuotes.ts";

/**
 * Checklist 3.9 — cron-triggered via app/api/cron/expire-stale-quotes/
 * route.ts (CRON_SECRET-gated), not consumed from `job_queue`. Expires
 * `quote_snapshots` with no response after `QUOTE_EXPIRY_HOURS` (default
 * 48h). Also registered as a `job_queue` handler in job-queue-worker for
 * manual/one-off triggering.
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  try {
    const supabase = getSupabaseServiceRoleClient();
    const result = await handleExpireStaleQuotes(supabase);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "expire-stale-quotes failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
