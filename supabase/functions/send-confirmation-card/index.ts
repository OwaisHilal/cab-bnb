import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleSendConfirmationCard } from "../_shared/handlers/sendConfirmationCard.ts";

/**
 * Checklist 3.7 — standalone-callable Edge Function, in addition to being
 * dispatched from job-queue-worker for `send_confirmation_card` job_queue
 * rows (enqueued by `parse-driver-details` on a successful parse, and by
 * app/api/admin/driver-details/[id]/correct/route.ts on manual ops
 * correction).
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  let body: { booking_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), { status: 400 });
  }

  if (!body.booking_id) {
    return new Response(JSON.stringify({ error: "booking_id is required" }), { status: 400 });
  }

  try {
    const supabase = getSupabaseServiceRoleClient();
    await handleSendConfirmationCard(supabase, { booking_id: body.booking_id });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "send-confirmation-card failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
