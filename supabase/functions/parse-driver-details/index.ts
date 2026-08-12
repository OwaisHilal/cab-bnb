import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleParseDriverDetails } from "../_shared/handlers/parseDriverDetails.ts";

/**
 * Checklist 3.6 — standalone-callable Edge Function, in addition to being
 * dispatched from job-queue-worker for `parse_driver_details` job_queue
 * rows (enqueued by the WhatsApp webhook, lib/whatsapp/webhook/
 * enqueueWebhookAction.ts, for any inbound text starting with `DRIVER:`).
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  let body: { raw_message_text?: string; from_phone?: string; wa_message_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), { status: 400 });
  }

  if (!body.raw_message_text || !body.from_phone) {
    return new Response(
      JSON.stringify({ error: "raw_message_text and from_phone are required" }),
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabaseServiceRoleClient();
    await handleParseDriverDetails(supabase, {
      raw_message_text: body.raw_message_text,
      from_phone: body.from_phone,
      wa_message_id: body.wa_message_id,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "parse-driver-details failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
