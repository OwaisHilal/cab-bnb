import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { processDueJobs } from "@/lib/jobs/processDueJobs";
import { phoneLast4 } from "@/lib/utils/phone";
import { stripE164Plus } from "@/lib/msg91/pure";
import { enqueueWebhookAction } from "./enqueueWebhookAction";
import { parseInboundAction } from "./parseInboundAction";
import { resolveSelectVendorTap } from "./resolveSelectVendorTap";
import { applyRideGroupWebhook } from "@/lib/whatsapp/applyRideGroupWebhook"
import {
  resolvePaymentReportAction,
  shouldEnqueuePaidFollowup,
} from "@/lib/whatsapp/paymentReport"
import type { InboundWhatsAppMessage, InboundWhatsAppPayment, InboundWhatsAppStatus } from "./types";

const DUPLICATE_KEY_ERROR_CODE = "23505";
const READ_STATUS = "read";
const TERMINAL_UNPAID_STATUSES = new Set(["failed", "cancelled", "canceled", "expired"]);

export async function processWhatsAppWebhook(
  supabase: SupabaseClient,
  messages: InboundWhatsAppMessage[],
  statuses: InboundWhatsAppStatus[],
  payments: InboundWhatsAppPayment[] = [],
  rawPayload?: unknown,
): Promise<void> {
  if (rawPayload) {
    try {
      await applyRideGroupWebhook(supabase, rawPayload)
    } catch (error) {
      console.error("[whatsapp webhook] failed to process ride group event", error)
    }
  }
  for (const message of messages) {
    try {
      const isDuplicate = await logInboundMessage(supabase, message);
      if (isDuplicate) continue;
      if (message.groupId) continue;

      let action = parseInboundAction(message);
      if (action.type === "unknown") {
        const resolved = await resolveSelectVendorTap(supabase, message);
        if (resolved) {
          action = resolved;
        }
      }
      // #region agent log
      fetch("http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f4fe3a" },
        body: JSON.stringify({
          sessionId: "f4fe3a",
          runId: "payment-tap",
          hypothesisId: "C",
          location: "lib/whatsapp/webhook/processWhatsAppWebhook.ts:inbound",
          message: "parsed inbound action",
          data: {
            last4: phoneLast4(message.fromPhone),
            action: action.type,
            hasButtonPayload: Boolean(message.buttonPayload),
            buttonPayloadPrefix: message.buttonPayload?.split("::")[0] ?? null,
            textLooksSelect: /^Select /i.test(message.textBody?.trim() ?? ""),
            resolvedFromTitle: action.type === "book_token" && !message.buttonPayload,
            isDuplicate,
            hasGroupId: Boolean(message.groupId),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      console.info("[whatsapp webhook] inbound", {
        last4: phoneLast4(message.fromPhone),
        action: action.type,
        hasButtonPayload: Boolean(message.buttonPayload),
        resolvedFromTitle: action.type === "book_token" && !message.buttonPayload,
        waMessageId: message.waMessageId,
      });
      await enqueueWebhookAction(supabase, action, message);
    } catch (error) {
      console.error("[whatsapp webhook] failed to process inbound message", error);
    }
  }

  for (const status of statuses) {
    try {
      await applyStatusUpdate(supabase, status);
    } catch (error) {
      console.error("[whatsapp webhook] failed to process status event", error);
    }
  }

  for (const payment of payments) {
    try {
      await processPaymentReport(supabase, payment);
    } catch (error) {
      console.error("[whatsapp webhook] failed to process payment report", error);
    }
  }

  after(() => {
    void processDueJobs(supabase)
      .then((jobs) => {
        console.info("[whatsapp webhook] jobs", jobs);
      })
      .catch((error: unknown) => {
        console.error("[whatsapp webhook] processDueJobs failed", error);
      });
  });
}

async function processPaymentReport(
  supabase: SupabaseClient,
  payment: InboundWhatsAppPayment,
): Promise<void> {
  if (!payment.paid) {
    await markIntentTerminalIfNeeded(supabase, payment);
    return;
  }

  if (!payment.crqid) {
    console.error("[whatsapp webhook] paid payment report missing crqid");
    return;
  }

  const intent = await loadPaymentIntent(supabase, payment.crqid);
  if (!intent) {
    console.error("[whatsapp webhook] paid payment report has no matching intent", payment.crqid);
    return;
  }

  const action = resolvePaymentReportAction(payment, intent.purpose, intent.booking_id);
  if (action === "ignore") {
    console.error("[whatsapp webhook] paid payment report ignored", {
      crqid: payment.crqid,
      purpose: intent.purpose,
    });
    return;
  }

  if (action === "balance") {
    const bookingId = intent.booking_id;
    if (!bookingId) {
      console.error("[whatsapp webhook] balance payment report missing booking_id", payment.crqid);
      return;
    }
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("payment_status")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingError) throw new Error(`Failed to load booking for balance payment: ${bookingError.message}`);
    if (
      shouldEnqueuePaidFollowup({
        action,
        bookingPaymentStatus: (booking?.payment_status as string | null) ?? null,
      })
    ) {
      const { error } = await supabase.from("job_queue").insert({
        job_type: "complete_balance_payment",
        payload: {
          booking_id: bookingId,
          wa_message_id: payment.waMessageId,
          payment_crqid: payment.crqid,
        },
      });
      if (error) {
        throw new Error(`Failed to enqueue complete_balance_payment: ${error.message}`);
      }
    }
    await markIntentPaid(supabase, payment.crqid);
    return;
  }

  const quoteSnapshotId = await resolvePaidQuoteSnapshotId(supabase, payment, intent);
  if (!quoteSnapshotId) {
    return;
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from("quote_snapshots")
    .select("id, status")
    .eq("id", quoteSnapshotId)
    .maybeSingle();

  if (snapshotError) {
    throw new Error(`Failed to load quote for paid token: ${snapshotError.message}`);
  }
  if (
    shouldEnqueuePaidFollowup({
      action,
      quoteStatus: (snapshot?.status as string | null) ?? null,
    })
  ) {
    const { error } = await supabase.from("job_queue").insert({
      job_type: "finalize_booking",
      payload: {
        quote_snapshot_id: quoteSnapshotId,
        lock_type: "token_99",
        wa_message_id: payment.waMessageId,
        payment_crqid: payment.crqid,
      },
    });

    if (error) {
      throw new Error(`Failed to enqueue finalize_booking after payment: ${error.message}`);
    }
  }

  await markIntentPaid(supabase, payment.crqid);
}

interface PaymentIntentRow {
  quote_snapshot_id: string | null;
  booking_id: string | null;
  status: string;
  customer_number: string | null;
  purpose: string | null;
}

async function loadPaymentIntent(
  supabase: SupabaseClient,
  crqid: string,
): Promise<PaymentIntentRow | null> {
  const { data: intent, error } = await supabase
    .from("whatsapp_payment_intents")
    .select("quote_snapshot_id, booking_id, status, customer_number, purpose")
    .eq("crqid", crqid)
    .maybeSingle();

  if (error) {
    if (isPaymentIntentTableMissing(error)) return null;
    if (isMissingIntentColumn(error, ["purpose", "booking_id"])) {
      const withBooking = await loadIntentWithoutPurpose(supabase, crqid);
      if (withBooking) return withBooking;
      const legacy = await loadLegacyTokenIntent(supabase, crqid);
      return legacy;
    }
    throw new Error(`Failed to load payment intent: ${error.message}`);
  }
  return (intent as PaymentIntentRow | null) ?? null;
}

async function loadIntentWithoutPurpose(
  supabase: SupabaseClient,
  crqid: string,
): Promise<PaymentIntentRow | null> {
  const { data, error } = await supabase
    .from("whatsapp_payment_intents")
    .select("quote_snapshot_id, booking_id, status, customer_number")
    .eq("crqid", crqid)
    .maybeSingle();
  if (error || !data) return null;
  const bookingId = (data.booking_id as string | null) ?? null;
  return {
    quote_snapshot_id: (data.quote_snapshot_id as string | null) ?? null,
    booking_id: bookingId,
    status: data.status as string,
    customer_number: (data.customer_number as string | null) ?? null,
    purpose: bookingId ? "balance" : "token_lock",
  };
}

async function loadLegacyTokenIntent(
  supabase: SupabaseClient,
  crqid: string,
): Promise<PaymentIntentRow | null> {
  const { data, error } = await supabase
    .from("whatsapp_payment_intents")
    .select("quote_snapshot_id, status, customer_number")
    .eq("crqid", crqid)
    .maybeSingle();
  if (error || !data) return null;
  return {
    quote_snapshot_id: (data.quote_snapshot_id as string | null) ?? null,
    booking_id: null,
    status: data.status as string,
    customer_number: (data.customer_number as string | null) ?? null,
    purpose: "token_lock",
  };
}

async function markIntentTerminalIfNeeded(
  supabase: SupabaseClient,
  payment: InboundWhatsAppPayment,
): Promise<void> {
  if (!payment.crqid) return;

  const normalized = payment.paymentStatus.trim().toLowerCase();
  if (!TERMINAL_UNPAID_STATUSES.has(normalized)) {
    return;
  }

  const nextStatus = normalized === "expired" ? "expired" : "failed";
  await supabase
    .from("whatsapp_payment_intents")
    .update({ status: nextStatus, last_error: payment.paymentStatus })
    .eq("crqid", payment.crqid)
    .in("status", ["pending", "sent"]);
}

async function markIntentPaid(
  supabase: SupabaseClient,
  crqid: string | null,
): Promise<"updated" | "already_paid" | "missing"> {
  if (!crqid) return "missing";

  const { data: updated, error } = await supabase
    .from("whatsapp_payment_intents")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("crqid", crqid)
    .in("status", ["pending", "sent", "failed"])
    .select("id")
    .maybeSingle();

  if (error) {
    if (isPaymentIntentTableMissing(error)) return "missing";
    throw new Error(`Failed to mark payment intent paid: ${error.message}`);
  }
  if (updated?.id) return "updated";

  const { data: existing } = await supabase
    .from("whatsapp_payment_intents")
    .select("status")
    .eq("crqid", crqid)
    .maybeSingle();

  if (existing?.status === "paid") return "already_paid";
  return "missing";
}

async function resolvePaidQuoteSnapshotId(
  supabase: SupabaseClient,
  payment: InboundWhatsAppPayment,
  intent: PaymentIntentRow | null,
): Promise<string | null> {
  if (!payment.crqid) {
    return null;
  }

  if (!intent?.quote_snapshot_id) {
    return null;
  }

  if (intent.status === "paid") {
    return intent.quote_snapshot_id;
  }
  if (intent.purpose && intent.purpose !== "token_lock") return null;
  if (
    payment.customerNumber &&
    intent.customer_number &&
    stripE164Plus(payment.customerNumber) !== stripE164Plus(String(intent.customer_number))
  ) {
    return null;
  }
  return intent.quote_snapshot_id;
}

function isMissingIntentColumn(error: { message: string }, columns: string[]): boolean {
  const message = error.message.toLowerCase();
  return columns.some((column) => message.includes(column));
}

function isPaymentIntentTableMissing(error: { code?: string; message: string }): boolean {
  const code = error.code ?? "";
  const message = error.message.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("whatsapp_payment_intents") &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")))
  );
}

async function applyStatusUpdate(supabase: SupabaseClient, status: InboundWhatsAppStatus): Promise<void> {
  const { error: logError } = await supabase
    .from("whatsapp_message_log")
    .update({ wa_status: status.status })
    .eq("wa_message_id", status.waMessageId);

  if (logError) throw new Error(`Failed to update whatsapp_message_log status: ${logError.message}`);

  if (status.status !== READ_STATUS) return;

  const { error: snapshotError } = await supabase
    .from("quote_snapshots")
    .update({ status: "viewed" })
    .eq("wa_message_id", status.waMessageId)
    .eq("status", "sent");

  if (snapshotError) throw new Error(`Failed to mark quote_snapshot viewed: ${snapshotError.message}`);
}

async function logInboundMessage(supabase: SupabaseClient, message: InboundWhatsAppMessage): Promise<boolean> {
  const { error } = await supabase.from("whatsapp_message_log").insert({
    direction: "inbound",
    wa_message_id: message.waMessageId,
    body_snapshot: message.textBody,
    button_payload: message.buttonPayload,
    interaction_type: message.interactionType,
    wa_status: "replied",
  });

  if (!error) return false;
  if (error.code === DUPLICATE_KEY_ERROR_CODE) return true;

  throw new Error(`Failed to log inbound WhatsApp message: ${error.message}`);
}
