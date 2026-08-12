import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface RecordLifecycleResponsePayload {
  lifecycle_event_id: string;
  response: "ok" | "help_requested";
}

/**
 * Checklist 3.10: records a `CHECKIN_OK`/`CHECKIN_HELP` button reply
 * (lib/whatsapp/webhook/parseInboundAction.ts) against its
 * `booking_lifecycle_events` row. Guarded by status so a duplicate/late
 * webhook delivery for an already-responded event is a safe no-op.
 */
export async function handleRecordLifecycleResponse(
  supabase: SupabaseClient,
  payload: RecordLifecycleResponsePayload,
): Promise<void> {
  const { lifecycle_event_id, response } = payload;

  const { error } = await supabase
    .from("booking_lifecycle_events")
    .update({ customer_response: response, response_at: new Date().toISOString(), status: "responded" })
    .eq("id", lifecycle_event_id)
    .in("status", ["scheduled", "sent"]);

  if (error) throw new Error(`Failed to record lifecycle response: ${error.message}`);
}
