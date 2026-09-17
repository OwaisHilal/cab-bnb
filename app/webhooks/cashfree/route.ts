import { NextRequest, after } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import {
  CASHFREE_PAYMENT_LINK_EVENT_TYPE,
  CASHFREE_PAYMENT_SUCCESS_STATUS,
  parseCashfreePaymentLinkWebhook,
  parseCashfreePaymentWebhook,
  verifyCashfreeWebhookSignature,
} from "@/lib/cashfree/pure";
import type { CashfreePaymentLinkWebhookData, CashfreePaymentWebhookData } from "@/lib/cashfree/types";
import { drainDueJobs } from "@/lib/jobs/drainDueJobs";
import { stripE164Plus } from "@/lib/msg91/pure";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { phoneLast4 } from "@/lib/utils/phone";
import { confirmPaymentByCrqid } from "@/lib/whatsapp/webhook/processWhatsAppWebhook";
import type { InboundWhatsAppPayment } from "@/lib/whatsapp/webhook/types";

// Signature verification uses node:crypto's timingSafeEqual, unavailable on the Edge runtime.
export const runtime = "nodejs";

interface PaymentIntentLookupRow {
  crqid: string;
  amount_inr: number;
  status: string;
}

/**
 * Canonical Cashfree webhook path — matches the dashboard config
 * (https://cab-bnb.vercel.app/webhooks/cashfree). Handles the PG Orders
 * payment webhook that lib/whatsapp/sendTokenPaymentLink.ts's
 * `createCashfreeOrder` orders produce, and still audit-logs the legacy
 * Payment Links `PAYMENT_LINK_EVENT` shape from the retired 0020/0021
 * static-link workaround (docs/cashfree-payment-links-workaround.md) in
 * case a stray one arrives.
 *
 * Always ack 200 once the signature verifies — Cashfree retries on non-2xx,
 * and an event we can't (or shouldn't) act on is not the sender's fault.
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

  const paymentWebhook = parseCashfreePaymentWebhook(payload);
  if (paymentWebhook?.data) {
    await handlePaymentWebhook(paymentWebhook.data);
    return jsonOk({ received: true, provider: "cashfree", type: paymentWebhook.type });
  }

  const linkWebhook = parseCashfreePaymentLinkWebhook(payload);
  if (linkWebhook?.type === CASHFREE_PAYMENT_LINK_EVENT_TYPE && linkWebhook.data) {
    logLegacyPaymentLinkEvent(linkWebhook.data, linkWebhook.eventTime);
    return jsonOk({ received: true, provider: "cashfree", audited: true });
  }

  // Cashfree may add new webhook types later — ack and no-op rather than error.
  console.info("[cashfree webhook] ignoring unrecognized payload", {
    type: paymentWebhook?.type ?? linkWebhook?.type ?? null,
  });
  return jsonOk({ received: true, provider: "cashfree", ignored: true });
}

async function handlePaymentWebhook(data: CashfreePaymentWebhookData): Promise<void> {
  const supabase = getSupabaseServiceRoleClient();

  const { data: intentRow, error: lookupError } = await supabase
    .from("whatsapp_payment_intents")
    .select("crqid, amount_inr, status")
    .eq("cf_order_id", data.orderId)
    .maybeSingle();

  if (lookupError) {
    console.error("[cashfree webhook] failed to look up payment intent", {
      orderId: data.orderId,
      error: lookupError.message,
    });
    return;
  }

  const intent = (intentRow ?? null) as PaymentIntentLookupRow | null;
  if (!intent) {
    console.error("[cashfree webhook] no payment intent matches cf_order_id", { orderId: data.orderId });
    return;
  }

  await supabase
    .from("whatsapp_payment_intents")
    .update({
      cf_payment_id: data.cfPaymentId ?? null,
      cashfree_payment_status: data.paymentStatus,
      cashfree_bank_reference: data.bankReference ?? null,
    })
    .eq("crqid", intent.crqid);

  console.info("[cashfree webhook] payment event", {
    crqid: intent.crqid,
    orderId: data.orderId,
    paymentStatus: data.paymentStatus,
    customerPhoneLast4: data.customerPhone ? phoneLast4(data.customerPhone) : null,
  });

  if (data.paymentStatus !== CASHFREE_PAYMENT_SUCCESS_STATUS) {
    // FAILED/USER_DROPPED/CANCELLED etc. — the order can often still accept
    // another attempt before it expires, so leave the intent as-is rather
    // than closing it out on one failed attempt.
    return;
  }

  const paidAmount = data.paymentAmount ?? data.orderAmount;
  if (typeof paidAmount === "number" && paidAmount !== intent.amount_inr) {
    console.error("[cashfree webhook] payment amount mismatch — refusing to finalize", {
      crqid: intent.crqid,
      expected: intent.amount_inr,
      received: paidAmount,
    });
    return;
  }

  const payment: InboundWhatsAppPayment = {
    crqid: intent.crqid,
    customerNumber: data.customerPhone ? stripE164Plus(data.customerPhone) : null,
    paymentStatus: data.paymentStatus,
    paid: true,
    waMessageId: null,
    timestamp: data.paymentTime ?? new Date().toISOString(),
    rawStatus: data.paymentStatus,
  };

  try {
    await confirmPaymentByCrqid(supabase, payment);
  } catch (error) {
    console.error("[cashfree webhook] confirmPaymentByCrqid failed", {
      crqid: intent.crqid,
      error: error instanceof Error ? error.message : error,
    });
    return;
  }

  after(async () => {
    try {
      const jobs = await drainDueJobs(supabase);
      console.info("[cashfree webhook] jobs", jobs);
    } catch (error) {
      console.error("[cashfree webhook] drainDueJobs failed", error);
    }
  });
}

function logLegacyPaymentLinkEvent(data: CashfreePaymentLinkWebhookData, eventTime: string): void {
  console.info("[cashfree webhook] legacy payment link event (audit only)", {
    linkId: data.linkId,
    status: data.linkStatus,
    linkAmount: data.linkAmount ?? null,
    linkAmountPaid: data.linkAmountPaid ?? null,
    customerPhoneLast4: data.customerPhone ? phoneLast4(data.customerPhone) : null,
    eventTime,
  });
}
