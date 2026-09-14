import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCashfreePaymentLink } from "./client";
import { confirmPaymentByCrqid } from "@/lib/whatsapp/webhook/processWhatsAppWebhook";
import type { InboundWhatsAppPayment } from "@/lib/whatsapp/webhook/types";

/**
 * Missed-webhook safety net (docs/cashfree-payment-links-workaround.md
 * "Known gap / fast-follow"). Cashfree webhook delivery is not guaranteed;
 * this polls `GET /pg/links/{link_id}` for any `sent` token_lock intent
 * that's been sitting long enough that a webhook should have already
 * arrived, and reconciles it the same way the webhook route would.
 *
 * Wired into the once-daily `dispatch-jobs` Vercel Cron (Hobby plan caps
 * cron frequency at once/day — see hobbyCronSchedule.ts) rather than its
 * own schedule, so it runs as a best-effort catch-up rather than a tight
 * loop. Real-time confirmation still comes from app/api/cashfree/webhook.
 */
export const CASHFREE_RECONCILE_STALE_MINUTES = 10;
export const CASHFREE_RECONCILE_BATCH_LIMIT = 25;

const TERMINAL_UNPAID_LINK_STATUSES = new Set(["cancelled", "canceled", "expired"]);

export interface ReconcileCashfreeLinksResult {
  checked: number;
  confirmed: number;
  errors: number;
}

interface StaleIntentRow {
  crqid: string | null;
}

export async function reconcilePendingCashfreePaymentLinks(
  supabase: SupabaseClient,
): Promise<ReconcileCashfreeLinksResult> {
  const staleBefore = new Date(Date.now() - CASHFREE_RECONCILE_STALE_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("whatsapp_payment_intents")
    .select("crqid")
    .eq("purpose", "token_lock")
    .eq("status", "sent")
    .not("payment_link_url", "is", null)
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(CASHFREE_RECONCILE_BATCH_LIMIT);

  if (error) {
    // Tolerate a pre-migration schema (missing purpose/payment_link_url
    // columns) the same way the rest of the payment-intent code does —
    // this reconciliation pass is best-effort, not load-bearing.
    console.error("[cashfree reconcile] failed to load stale sent intents", error.message);
    return { checked: 0, confirmed: 0, errors: 0 };
  }

  const rows = (data ?? []) as StaleIntentRow[];
  let confirmed = 0;
  let errors = 0;

  for (const row of rows) {
    if (!row.crqid) continue;
    try {
      if (await reconcileOne(supabase, row.crqid)) confirmed += 1;
    } catch (reconcileError) {
      errors += 1;
      console.error("[cashfree reconcile] failed to reconcile intent", row.crqid, reconcileError);
    }
  }

  return { checked: rows.length, confirmed, errors };
}

async function reconcileOne(supabase: SupabaseClient, crqid: string): Promise<boolean> {
  const link = await getCashfreePaymentLink(crqid);
  if (!link.success || !link.linkStatus) {
    if (!link.configured) return false; // Cashfree not configured — nothing to reconcile.
    console.error("[cashfree reconcile] GET link failed", { crqid, error: link.error ?? null });
    return false;
  }

  const status = link.linkStatus.trim().toUpperCase();

  if (status === "PARTIALLY_PAID") {
    console.error("[cashfree reconcile] unexpected PARTIALLY_PAID despite link_partial_payments=false", {
      crqid,
      linkAmountPaid: link.linkAmountPaid ?? null,
    });
    return false;
  }

  const paid = status === "PAID";
  if (!paid && !TERMINAL_UNPAID_LINK_STATUSES.has(status.toLowerCase())) {
    // Still ACTIVE — customer hasn't paid yet. Nothing to do.
    return false;
  }

  const payment: InboundWhatsAppPayment = {
    crqid,
    customerNumber: null,
    paymentStatus: status,
    paid,
    waMessageId: null,
    timestamp: new Date().toISOString(),
    rawStatus: status,
  };

  await confirmPaymentByCrqid(supabase, payment);
  return paid;
}
