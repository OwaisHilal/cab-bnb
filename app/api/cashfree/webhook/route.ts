import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { after } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { CASHFREE_PAYMENT_LINK_EVENT_TYPE, parseCashfreePaymentLinkWebhook, verifyCashfreeWebhookSignature } from "@/lib/cashfree/pure";
import type { CashfreePaymentLinkWebhookData } from "@/lib/cashfree/types";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { confirmPaymentByCrqid, drainWhatsAppWebhookJobs } from "@/lib/whatsapp/webhook/processWhatsAppWebhook";
import type { InboundWhatsAppPayment } from "@/lib/whatsapp/webhook/types";

// Signature verification uses node:crypto's timingSafeEqual, unavailable on the Edge runtime.
export const runtime = "nodejs";

const TERMINAL_UNPAID_LINK_STATUSES = new Set(["cancelled", "canceled", "expired"]);

/**
 * Cashfree Payment Links webhook — confirms the ₹99 token payments created
 * by lib/whatsapp/sendTokenPaymentLink.ts via lib/cashfree/client.ts. This
 * is a separate provider/endpoint from MSG91's own "On Payment Report
 * Received" webhook (app/api/whatsapp/webhook), used because MSG91's
 * `payment_link` interactive type is blocked by Cashfree's
 * `s2s_enabled_not_approved`. See docs/cashfree-payment-links-workaround.md.
 *
 * Always ack 200 once the signature verifies — Cashfree retries on non-2xx,
 * and downstream failures are logged rather than turned into retriable 5xxs
 * once we've already recorded the event.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const secret = process.env.CASHFREE_SECRET_KEY?.trim();
  if (!secret) {
    return jsonError(500, "Missing CASHFREE_SECRET_KEY. Copy .env.example to .env.local and fill it in.");
  }

  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");

  if (!signature || !timestamp) {
    return jsonError(400, "Missing x-webhook-signature or x-webhook-timestamp header");
  }

  if (!verifyCashfreeWebhookSignature({ rawBody, timestamp, signature, secret })) {
    return jsonError(401, "Invalid Cashfree webhook signature");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const parsed = parseCashfreePaymentLinkWebhook(payload);

  if (!parsed) {
    return jsonError(400, "Unrecognized Cashfree webhook payload");
  }

  if (parsed.type !== CASHFREE_PAYMENT_LINK_EVENT_TYPE) {
    // Cashfree may add new webhook types later — ack and no-op rather than error.
    console.info("[cashfree webhook] ignoring unhandled event type", { type: parsed.type });
    return jsonOk({ received: true, provider: "cashfree", ignored: true });
  }

  if (parsed.data) {
    try {
      await handlePaymentLinkEvent(supabase, parsed.data, parsed.eventTime);
    } catch (error) {
      console.error("[cashfree webhook] failed to process payment link event", error);
    }
  } else {
    console.error("[cashfree webhook] PAYMENT_LINK_EVENT missing usable data", { rawBody });
  }

  after(() => drainWhatsAppWebhookJobs(supabase));

  return jsonOk({ received: true, provider: "cashfree" });
}

async function handlePaymentLinkEvent(
  supabase: SupabaseClient,
  data: CashfreePaymentLinkWebhookData,
  eventTime: string,
): Promise<void> {
  const status = data.linkStatus.trim().toUpperCase();

  if (status === "PARTIALLY_PAID") {
    // link_partial_payments is set to false when we create the link, so a
    // partial payment here means a merchant-dashboard-level setting
    // overrode it. Surface it, but don't finalize the booking on a partial.
    console.error("[cashfree webhook] unexpected PARTIALLY_PAID despite link_partial_payments=false", {
      linkId: data.linkId,
      linkAmount: data.linkAmount ?? null,
      linkAmountPaid: data.linkAmountPaid ?? null,
    });
    return;
  }

  // Deliberately omit customerNumber: Cashfree reports a bare 10-digit
  // number while whatsapp_payment_intents.customer_number is stored without
  // "+" but with the "91" country code, and confirmPaymentByCrqid's mismatch
  // guard would otherwise reject a legitimate confirmation. `crqid` (the
  // Cashfree link_id) is already the authoritative correlation key.
  const payment: InboundWhatsAppPayment = {
    crqid: data.linkId,
    customerNumber: null,
    paymentStatus: status,
    paid: status === "PAID",
    waMessageId: null,
    timestamp: eventTime,
    rawStatus: status,
  };

  if (!payment.paid && !TERMINAL_UNPAID_LINK_STATUSES.has(status.toLowerCase())) {
    // Some other non-terminal, non-paid status (e.g. ACTIVE) — nothing to do yet.
    return;
  }

  await confirmPaymentByCrqid(supabase, payment);
}
