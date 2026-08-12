import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleNotifyVendorBooking } from "../_shared/handlers/notifyVendorBooking.ts";

/**
 * Checklist 3.5 — standalone-callable Edge Function, in addition to being
 * dispatched from job-queue-worker for `notify_vendor_booking` job_queue
 * rows (enqueued by the `finalize_quote_booking` Postgres function,
 * migration 0009, immediately after a booking commits).
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
    await handleNotifyVendorBooking(supabase, { booking_id: body.booking_id });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "notify-vendor-booking failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
