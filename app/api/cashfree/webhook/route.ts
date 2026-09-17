import type { NextRequest } from "next/server";
import { POST as handleCashfreeWebhook } from "@/app/webhooks/cashfree/route";

// Signature verification uses node:crypto's timingSafeEqual, unavailable on the Edge runtime.
export const runtime = "nodejs";

/**
 * Compatibility alias for app/webhooks/cashfree/route.ts, the canonical
 * path the Cashfree dashboard is actually configured to call
 * (https://cab-bnb.vercel.app/webhooks/cashfree). Kept in case any older
 * Cashfree webhook config still points at /api/cashfree/webhook — delegates
 * to the same handler rather than duplicating signature verification and
 * payment-confirmation logic.
 */
export async function POST(request: NextRequest) {
  return handleCashfreeWebhook(request);
}
