import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { CASHFREE_PAYMENT_LINK_EVENT_TYPE, parseCashfreePaymentLinkWebhook, verifyCashfreeWebhookSignature } from "@/lib/cashfree/pure";
import type { CashfreePaymentLinkWebhookData } from "@/lib/cashfree/types";
import { phoneLast4 } from "@/lib/utils/phone";

// Signature verification uses node:crypto's timingSafeEqual, unavailable on the Edge runtime.
export const runtime = "nodejs";

/**
 * Cashfree Payment Links webhook — audit logging only.
 *
 * lib/whatsapp/sendTokenPaymentLink.ts sends every ₹99 token payment as the
 * same dashboard-created static Cashfree link (both MSG91's `payment_link`
 * interactive type and Cashfree's own dynamic Payment Links create-API are
 * blocked on this merchant account — see
 * docs/cashfree-payment-links-workaround.md). Because the link is shared
 * across every booking, a webhook event here cannot be safely mapped back to
 * one specific quote/booking, so this route only verifies and logs events
 * for manual/ops review — it does not call confirmPaymentByCrqid or enqueue
 * any follow-up job. Payment confirmation for a booking must be done
 * manually until a per-booking correlation mechanism exists again.
 *
 * Always ack 200 once the signature verifies — Cashfree retries on non-2xx.
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
    logPaymentLinkEvent(parsed.data, parsed.eventTime);
  } else {
    console.error("[cashfree webhook] PAYMENT_LINK_EVENT missing usable data", { rawBody });
  }

  return jsonOk({ received: true, provider: "cashfree", audited: true });
}

function logPaymentLinkEvent(data: CashfreePaymentLinkWebhookData, eventTime: string): void {
  console.info("[cashfree webhook] payment link event (audit only — manual confirmation required)", {
    linkId: data.linkId,
    status: data.linkStatus,
    linkAmount: data.linkAmount ?? null,
    linkAmountPaid: data.linkAmountPaid ?? null,
    customerPhoneLast4: data.customerPhone ? phoneLast4(data.customerPhone) : null,
    eventTime,
  });
}
