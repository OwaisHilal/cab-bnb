import { getSupabaseServiceRoleClient } from "../_shared/supabaseAdmin.ts";
import { verifyServiceRoleCaller } from "../_shared/verifyServiceRoleCaller.ts";
import { handleFinalizeBooking } from "../_shared/handlers/finalizeBooking.ts";

const VALID_LOCK_TYPES = ["full_payment", "token_99"] as const;
type LockType = (typeof VALID_LOCK_TYPES)[number];

function isValidLockType(value: unknown): value is LockType {
  return typeof value === "string" && (VALID_LOCK_TYPES as readonly string[]).includes(value);
}

/**
 * Checklist 3.4 — standalone-callable Edge Function, in addition to being
 * dispatched from job-queue-worker for `finalize_booking` job_queue rows.
 */
Deno.serve(async (req: Request) => {
  const authError = verifyServiceRoleCaller(req);
  if (authError) return authError;

  let body: { quote_snapshot_id?: string; lock_type?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), { status: 400 });
  }

  if (!body.quote_snapshot_id) {
    return new Response(JSON.stringify({ error: "quote_snapshot_id is required" }), { status: 400 });
  }

  if (!isValidLockType(body.lock_type)) {
    return new Response(
      JSON.stringify({ error: "lock_type must be one of: full_payment, token_99" }),
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabaseServiceRoleClient();
    await handleFinalizeBooking(supabase, {
      quote_snapshot_id: body.quote_snapshot_id,
      lock_type: body.lock_type,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "finalize-booking failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
