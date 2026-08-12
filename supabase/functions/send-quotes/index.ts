import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleSendQuotes } from "../_shared/handlers/sendQuotes.ts";

/**
 * Checklist 3.2 — standalone-callable Edge Function (e.g. `supabase.functions
 * .invoke("send-quotes", { body: { trip_request_id } })`), in addition to
 * being dispatched from job-queue-worker for `send_quotes` job_queue rows.
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  let body: { trip_request_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), { status: 400 });
  }

  if (!body.trip_request_id) {
    return new Response(JSON.stringify({ error: "trip_request_id is required" }), { status: 400 });
  }

  try {
    const supabase = getSupabaseServiceRoleClient();
    await handleSendQuotes(supabase, { trip_request_id: body.trip_request_id });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "send-quotes failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
