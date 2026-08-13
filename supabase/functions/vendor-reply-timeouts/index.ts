import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleVendorReplyTimeouts } from "../_shared/handlers/vendorReplyTimeouts.ts";

/**
 * Plan §9 / Phase 3 final pass — cron-triggered via
 * app/api/cron/vendor-reply-timeouts/route.ts (CRON_SECRET-gated), not
 * consumed from `job_queue`. Escalates bookings still waiting on a
 * vendor's `DRIVER:` reply past `VENDOR_DRIVER_DETAIL_SLA_MINUTES` to ops.
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  try {
    const supabase = getSupabaseServiceRoleClient();
    const result = await handleVendorReplyTimeouts(supabase);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "vendor-reply-timeouts failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
