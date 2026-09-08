import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemoMode } from "@/lib/otp/demoMode";
import type { InboundWhatsAppMessage, ParsedAction } from "./types";

/**
 * Checklist 2.5: "insert job_queue row per action (never process WhatsApp
 * send synchronously inside webhook handler)". Every branch below only
 * writes to `job_queue` — `job-queue-worker` (Checklist 3.10) has a
 * registered handler for every job_type enqueued here.
 */
export async function enqueueWebhookAction(
  supabase: SupabaseClient,
  action: ParsedAction,
  message: InboundWhatsAppMessage,
): Promise<void> {
  const waMessageId = message.waMessageId;

  switch (action.type) {
    case "book_full":
      await enqueueJob(supabase, "finalize_booking", {
        quote_snapshot_id: action.quoteSnapshotId,
        lock_type: "full_payment",
        wa_message_id: waMessageId,
      });
      return;

    case "book_token":
      await enqueueJob(supabase, "send_token_payment_link", {
        quote_snapshot_id: action.quoteSnapshotId,
        wa_message_id: waMessageId,
      });
      // #region agent log
      fetch("http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f4fe3a" },
        body: JSON.stringify({
          sessionId: "f4fe3a",
          runId: "payment-tap",
          hypothesisId: "D",
          location: "lib/whatsapp/webhook/enqueueWebhookAction.ts:book_token",
          message: "enqueued send_token_payment_link",
          data: { hasQuoteSnapshotId: Boolean(action.quoteSnapshotId) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return;

    case "token_pay":
      if (!isDemoMode()) return;
      await enqueueJob(supabase, "finalize_booking", {
        quote_snapshot_id: action.quoteSnapshotId,
        lock_type: "token_99",
        wa_message_id: waMessageId,
      });
      return;

    case "negotiate":
      await enqueueJob(supabase, "compute_negotiation", {
        quote_snapshot_id: action.quoteSnapshotId,
        wa_message_id: waMessageId,
      });
      return;

    case "checkin_ok":
      await enqueueJob(supabase, "record_lifecycle_response", {
        lifecycle_event_id: action.lifecycleEventId,
        response: "ok",
        wa_message_id: waMessageId,
      });
      return;

    case "checkin_help":
      await enqueueJob(supabase, "record_lifecycle_response", {
        lifecycle_event_id: action.lifecycleEventId,
        response: "help_requested",
        wa_message_id: waMessageId,
      });
      await enqueueJob(supabase, "ops_alert", {
        reason: "checkin_help_requested",
        lifecycle_event_id: action.lifecycleEventId,
        wa_message_id: waMessageId,
      });
      return;

    case "rate":
      await enqueueJob(supabase, "record_review", {
        booking_id: action.bookingId,
        rating: action.rating,
        wa_message_id: waMessageId,
      });
      return;

    case "complete_payment":
      if (!isDemoMode()) return;
      if (!action.bookingId) return;
      await enqueueJob(supabase, "complete_balance_payment", {
        booking_id: action.bookingId,
        wa_message_id: waMessageId,
      });
      return;

    case "driver_details":
      await enqueueJob(supabase, "parse_driver_details", {
        raw_message_text: message.textBody,
        from_phone: message.fromPhone,
        parsed_preview: action.driverDetails,
        wa_message_id: waMessageId,
      });
      return;

    case "unknown":
      // Already recorded via whatsapp_message_log — no job, to avoid
      // acting on arbitrary/unsupported inbound text.
      return;
  }
}

async function enqueueJob(
  supabase: SupabaseClient,
  jobType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("job_queue").insert({ job_type: jobType, payload });
  if (error) {
    throw new Error(`Failed to enqueue ${jobType} job: ${error.message}`);
  }
}
