import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleDispatchLifecycleEvents } from "../_shared/handlers/dispatchLifecycleEvents.ts";

/**
 * Checklist 3.8 — cron-triggered via app/api/cron/dispatch-lifecycle-events/
 * route.ts (CRON_SECRET-gated), not consumed from `job_queue`. Sends any
 * due `booking_lifecycle_events` row (`status = 'scheduled'` and
 * `scheduled_at <= now()`). Also registered as a `job_queue` handler in
 * job-queue-worker for manual/one-off triggering.
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  try {
    const supabase = getSupabaseServiceRoleClient();
    const result = await handleDispatchLifecycleEvents(supabase);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "dispatch-lifecycle-events failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
