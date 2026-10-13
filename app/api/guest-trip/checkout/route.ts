import { NextRequest } from "next/server";
import { z } from "zod";
import { decideCheckout } from "@/lib/cashfree/decideCheckout";
import { fetchCashfreeOrderStatus } from "@/lib/cashfree/fetchOrderStatus";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { loadGuestTrip, sessionCanReadTrip } from "@/lib/guest-trip/loadGuestTrip";
import { isDemoMode } from "@/lib/otp/demoMode";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { getAppBaseUrl } from "@/lib/utils/appUrl";
import { ensureCashfreeOrderForIntent } from "@/lib/whatsapp/ensureCashfreeOrderForIntent";
import { handleSendBalancePayment } from "@/lib/whatsapp/sendBalancePaymentLink";
import { drainDueJobs } from "@/lib/jobs/drainDueJobs";
import { confirmPaymentByCrqid } from "@/lib/whatsapp/webhook/processWhatsAppWebhook";

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  session_id: z.string().min(1),
  crqid: z.string().uuid().optional(),
  returned: z.boolean().optional(),
});

interface IntentRow {
  id: string
  status: string
  purpose: string | null
  cf_order_id: string | null
  amount_inr: number
  customer_number: string
  trip_request_id: string
  booking_id: string | null
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  // #region agent log
  fetch('http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'59deff'},body:JSON.stringify({sessionId:'59deff',runId:'initial',hypothesisId:'H5-server-entry',location:'app/api/guest-trip/checkout/route.ts:POST',message:'checkout POST entered',data:{crqid:parsed.data.crqid ?? null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  try {
    const intent = await resolveIntent(supabase, parsed.data.session_id, parsed.data.crqid);
    if (!intent) return jsonError(404, "No trip for this session");

    const allowed = await sessionCanReadTrip(supabase, parsed.data.session_id, intent.trip_request_id);
    if (!allowed) return jsonError(404, "No trip for this session");

    if (isDemoMode()) {
      await confirmPaymentByCrqid(supabase, {
        crqid: intent.id,
        customerNumber: intent.customer_number,
        paymentStatus: "paid",
        paid: true,
        waMessageId: null,
        timestamp: new Date().toISOString(),
        rawStatus: "demo",
      });
      await drainDueJobs(supabase, {
        jobTypes: ["finalize_booking", "complete_balance_payment", "send_token_received_ack", "send_balance_payment"],
      });
      return jsonOk({ outcome: "already_paid" });
    }

    let cashfreeOrderStatus: string | null = null;
    let fetchOrderStatusMs: number | null = null;
    if (intent.status !== "paid" && intent.cf_order_id) {
      const orderStatusStartedAt = Date.now();
      cashfreeOrderStatus = await fetchCashfreeOrderStatus(intent.cf_order_id);
      fetchOrderStatusMs = Date.now() - orderStatusStartedAt;
    }

    const decision = decideCheckout({
      intentStatus: intent.status,
      cashfreeOrderStatus,
    });

    if (intent.status === "paid" || (decision === "already_paid" && intent.status === "paid")) {
      return jsonOk({ outcome: "already_paid" });
    }

    if (decision === "already_paid") {
      const step = intent.purpose === "balance" ? "driver_contact" : "token_received";
      const preview = await loadGuestTrip(supabase, {
        sessionId: parsed.data.session_id,
        confirming: null,
        previewStep: step,
      });
      return jsonOk({
        outcome: "show_next_step",
        step,
        bodyText: preview?.bodyText ?? "",
        driverPhone: preview?.driverPhone ?? null,
        driverName: preview?.driverName ?? null,
        vehicleLabel: preview?.vehicleLabel ?? null,
        vehicleNumber: preview?.vehicleNumber ?? null,
        operatorName: preview?.operatorName ?? null,
        footerText: preview?.footerText ?? null,
        rideGroupInviteUrl: preview?.rideGroupInviteUrl ?? null,
      });
    }

    if (parsed.data.returned) {
      return jsonOk({ outcome: "confirming" });
    }

    const phone = await loadTouristPhone(supabase, intent.trip_request_id);
    if (!phone) return jsonError(404, "No trip for this session");

    const confirming = intent.purpose === "balance" ? "balance" : "token";
    const appBaseUrl = getAppBaseUrl();
    const ensureOrderStartedAt = Date.now();
    const orderResult = await ensureCashfreeOrderForIntent(supabase, {
      crqid: intent.id,
      touristPhone: phone,
      customerNumber: intent.customer_number,
      amountInr: Number(intent.amount_inr),
      returnUrl: `${appBaseUrl}/?continue=1&confirming=${confirming}`,
      notifyUrl: `${appBaseUrl}/webhooks/cashfree`,
    });
    const ensureOrderMs = Date.now() - ensureOrderStartedAt;

    if (!orderResult.success) {
      // #region agent log
      fetch('http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'59deff'},body:JSON.stringify({sessionId:'59deff',runId:'initial',hypothesisId:'H1-order-create-fetch',location:'app/api/guest-trip/checkout/route.ts:POST',message:'ensureCashfreeOrderForIntent failed',data:{fetchOrderStatusMs,ensureOrderMs,totalMs:Date.now()-requestStartedAt,error:orderResult.error ?? null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return jsonError(500, orderResult.error ?? "Couldn't start checkout");
    }

    // #region agent log
    fetch('http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'59deff'},body:JSON.stringify({sessionId:'59deff',runId:'initial',hypothesisId:'H1-H2-server-timings',location:'app/api/guest-trip/checkout/route.ts:POST',message:'checkout POST success summary',data:{fetchOrderStatusMs,ensureOrderMs,totalMs:Date.now()-requestStartedAt,hadExistingCfOrderId:Boolean(intent.cf_order_id)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    return jsonOk({ outcome: "checkout", href: `/pay/token/${intent.id}` });
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7783/ingest/080f2f3b-a7b7-4f0a-a5fe-1c40b1d12f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'59deff'},body:JSON.stringify({sessionId:'59deff',runId:'initial',hypothesisId:'H1-H2-server-error',location:'app/api/guest-trip/checkout/route.ts:POST',message:'checkout POST threw',data:{totalMs:Date.now()-requestStartedAt,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return jsonError(500, error instanceof Error ? error.message : "Failed to start checkout");
  }
}

const resolveIntent = async (
  supabase: ReturnType<typeof getSupabaseServiceRoleClient>,
  sessionId: string,
  crqid: string | undefined,
): Promise<IntentRow | null> => {
  if (crqid) {
    const { data, error } = await supabase
      .from("whatsapp_payment_intents")
      .select("id, status, purpose, cf_order_id, amount_inr, customer_number, trip_request_id, booking_id")
      .eq("id", crqid)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch payment intent: ${error.message}`);
    return (data as IntentRow | null) ?? null;
  }

  const snapshot = await loadGuestTrip(supabase, { sessionId, confirming: null });
  if (!snapshot || snapshot.step !== "balance") return null;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id")
    .eq("trip_request_id", snapshot.tripRequestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  if (!booking?.id) return null;

  await handleSendBalancePayment(supabase, { booking_id: booking.id as string });

  const { data: created, error: createdError } = await supabase
    .from("whatsapp_payment_intents")
    .select("id, status, purpose, cf_order_id, amount_inr, customer_number, trip_request_id, booking_id")
    .eq("booking_id", booking.id)
    .eq("purpose", "balance")
    .in("status", ["pending", "sent", "paid"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (createdError) throw new Error(`Failed to fetch balance intent: ${createdError.message}`);
  return (created as IntentRow | null) ?? null;
};

const loadTouristPhone = async (
  supabase: ReturnType<typeof getSupabaseServiceRoleClient>,
  tripRequestId: string,
): Promise<string | null> => {
  const { data, error } = await supabase
    .from("trip_requests")
    .select("tourists(phone_e164)")
    .eq("id", tripRequestId)
    .maybeSingle();

  if (error || !data) return null;
  const tourist = data.tourists as { phone_e164: string } | { phone_e164: string }[] | null;
  if (!tourist) return null;
  return Array.isArray(tourist) ? tourist[0]?.phone_e164 ?? null : tourist.phone_e164;
};
