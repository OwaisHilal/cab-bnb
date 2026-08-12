import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleComputeNegotiation } from "../_shared/handlers/computeNegotiation.ts";

/**
 * Checklist 3.3 — standalone-callable Edge Function, in addition to being
 * dispatched from job-queue-worker for `compute_negotiation` job_queue rows.
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  let body: { quote_snapshot_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), { status: 400 });
  }

  if (!body.quote_snapshot_id) {
    return new Response(JSON.stringify({ error: "quote_snapshot_id is required" }), { status: 400 });
  }

  try {
    const supabase = getSupabaseServiceRoleClient();
    await handleComputeNegotiation(supabase, { quote_snapshot_id: body.quote_snapshot_id });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "compute-negotiation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
