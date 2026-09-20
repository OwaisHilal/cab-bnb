import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { stripE164Plus } from "@/lib/msg91/pure"
import { composeAndUploadDriverCard } from "@/lib/drivers/composeDriverCard"
import { getAppBaseUrl } from "@/lib/utils/appUrl"
import { ensureCashfreeOrderForIntent } from "@/lib/whatsapp/ensureCashfreeOrderForIntent"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import { sendWhatsAppCtaUrlMessage, sendWhatsAppImageMessage } from "@/lib/whatsapp/sendOutbound"
import { buildTokenPaymentPageUrl } from "@/lib/whatsapp/tokenPaymentLink"
import {
  DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY,
  buildBalancePaymentLinkCopy,
  calculateBalanceDue,
} from "@/lib/whatsapp/balancePaymentLink"

const BALANCE_PAY_BUTTON_TITLE = "Pay Balance"

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

const DUPLICATE_KEY_ERROR_CODE = "23505"

const isMissingRelation = (error: { code?: string; message: string }): boolean => {
  const code = error.code ?? ""
  const message = error.message.toLowerCase()
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("whatsapp_payment_intents") &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")))
  )
}

const enqueueJob = async (
  supabase: SupabaseClient,
  jobType: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  const { error } = await supabase.from("job_queue").insert({ job_type: jobType, payload })
  if (error) throw new Error(`Failed to enqueue ${jobType} job: ${error.message}`)
}

export const handleSendBalancePayment = async (
  supabase: SupabaseClient,
  payload: { booking_id: string },
): Promise<void> => {
  const bookingId = payload.booking_id
  if (!bookingId) throw new Error("send_balance_payment requires booking_id")

  await ensureMessageTemplates(supabase)

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, payment_status, lock_type, final_quote, trip_days, pax_count, tourist_id, vendor_id, trip_request_id, winning_quote_snapshot_id, pickup_at, tourists(phone_e164), vendors(business_name, reliability_score), vehicle_types(label, code), trip_requests(pickup_location, drop_location, trip_start_date), drivers(full_name, photo_url), vehicles(stock_photo_url, registration_number, model)",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)
  if (!booking) throw new Error(`booking ${bookingId} not found`)
  if (booking.lock_type !== "token_99") return
  if (booking.payment_status === "fully_paid") return

  const { data: existingLog, error: logLookupError } = await supabase
    .from("whatsapp_message_log")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("direction", "outbound")
    .eq("template_name", DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY)
    .limit(1)
    .maybeSingle()
  if (logLookupError) throw new Error(`Failed to check balance payment log: ${logLookupError.message}`)
  if (existingLog?.id) return

  const touristPhone = firstOrSelf(booking.tourists as { phone_e164: string } | { phone_e164: string }[] | null)
    ?.phone_e164
  if (!touristPhone) throw new Error(`booking ${bookingId} has no verified tourist phone`)

  const { data: driverDetail, error: driverDetailError } = await supabase
    .from("driver_detail_submissions")
    .select("parsed_driver_name, parsed_driver_phone, parsed_vehicle_number, parsed_vehicle_model")
    .eq("booking_id", bookingId)
    .in("parse_status", ["parsed_ok", "ops_corrected"])
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (driverDetailError) throw new Error(`Failed to verify driver details: ${driverDetailError.message}`)
  if (!driverDetail) throw new Error(`booking ${bookingId} has no parsed driver details yet`)

  const balanceDue = calculateBalanceDue(Number(booking.final_quote ?? 0), booking.trip_days as number)
  if (balanceDue <= 0) {
    await enqueueJob(supabase, "complete_balance_payment", { booking_id: bookingId })
    return
  }

  const customerNumber = stripE164Plus(touristPhone)
  const { crqid, intentReady, alreadySent } = await upsertBalanceIntent(supabase, {
    bookingId,
    quoteSnapshotId: booking.winning_quote_snapshot_id as string,
    tripRequestId: booking.trip_request_id as string,
    touristId: booking.tourist_id as string,
    vendorId: booking.vendor_id as string,
    customerNumber,
    amountInr: balanceDue,
  })
  if (alreadySent) return
  if (!intentReady) {
    throw new Error(
      "send_balance_payment requires the whatsapp_payment_intents table (migration 0022) — Cashfree PG Orders needs a payment intent id to correlate the webhook back to this booking",
    )
  }

  const vendor = firstOrSelf(
    booking.vendors as
      | { business_name: string; reliability_score: number | null }
      | { business_name: string; reliability_score: number | null }[]
      | null,
  )
  const trip = firstOrSelf(
    booking.trip_requests as
      | { pickup_location: string | null; drop_location: string | null; trip_start_date: string }
      | { pickup_location: string | null; drop_location: string | null; trip_start_date: string }[]
      | null,
  )
  const vehicleType = firstOrSelf(
    booking.vehicle_types as { label: string; code: string } | { label: string; code: string }[] | null,
  )
  const linkedDriver = firstOrSelf(
    booking.drivers as { full_name: string; photo_url: string | null } | { full_name: string; photo_url: string | null }[] | null,
  )
  const linkedVehicle = firstOrSelf(
    booking.vehicles as
      | { stock_photo_url: string | null; registration_number: string | null; model: string | null }
      | { stock_photo_url: string | null; registration_number: string | null; model: string | null }[]
      | null,
  )

  const driverName = (driverDetail.parsed_driver_name as string | null) ?? linkedDriver?.full_name ?? "Your driver"
  const vehicleModel = (driverDetail.parsed_vehicle_model as string | null) ?? linkedVehicle?.model ?? "Vehicle"
  const vehicleNumber = (driverDetail.parsed_vehicle_number as string | null) ?? linkedVehicle?.registration_number ?? "TBD"

  const copy = buildBalancePaymentLinkCopy({
    tripDays: booking.trip_days as number,
    paxCount: booking.pax_count as number,
    vehicleLabel: vehicleType?.label ?? "Cab",
    pickupLocation: trip?.pickup_location,
    dropLocation: trip?.drop_location,
    vendorName: vendor?.business_name ?? "your operator",
    pricePerDay: Number(booking.final_quote ?? 0),
    rating: vendor?.reliability_score ?? null,
    driverName,
    vehicleModel,
    vehicleNumber,
    balanceDue,
  })

  const headerImageUrl = await composeAndUploadDriverCard(supabase, {
    driverName,
    photoUrl: linkedDriver?.photo_url,
    stockPhotoUrl: linkedVehicle?.stock_photo_url,
    vehicleCode: vehicleType?.code ?? null,
  })

  // Best-effort driver/vehicle photo — sent as a plain image message ahead
  // of the payment CTA. Never blocks the payment link on failure; this is
  // decoration, not the thing the guest needs to actually pay. Outcome is
  // still recorded on the eventual whatsapp_message_log row (media field)
  // so admin/debug replay can show whether the card was attempted and sent.
  const mediaCardResult: { attempted: boolean; sent: boolean; waMessageId: string | null; error: string | null } = {
    attempted: false,
    sent: false,
    waMessageId: null,
    error: null,
  }
  if (headerImageUrl) {
    mediaCardResult.attempted = true
    try {
      const imageSend = await sendWhatsAppImageMessage(
        touristPhone,
        headerImageUrl,
        `${driverName} · ${vehicleModel} (${vehicleNumber})`,
      )
      mediaCardResult.sent = imageSend.success
      mediaCardResult.waMessageId = imageSend.waMessageId ?? null
      mediaCardResult.error = imageSend.error ?? null
      if (!imageSend.success) {
        console.error("[balance pay] header image send failed", { bookingId, error: imageSend.error })
      }
    } catch (error) {
      mediaCardResult.error = error instanceof Error ? error.message : "Unknown media send error"
      console.error("[balance pay] header image send failed", error)
    }
  }

  const appBaseUrl = getAppBaseUrl()
  const orderResult = await ensureCashfreeOrderForIntent(supabase, {
    crqid,
    touristPhone,
    customerNumber,
    amountInr: balanceDue,
    returnUrl: `${appBaseUrl}/pay/token/${crqid}?order_id={order_id}`,
    notifyUrl: `${appBaseUrl}/webhooks/cashfree`,
  })

  if (!orderResult.success) {
    await supabase
      .from("whatsapp_payment_intents")
      .update({ last_error: orderResult.error ?? "cashfree_order_create_failed" })
      .eq("id", crqid)
      .in("status", ["pending", "sent"])
    throw new Error(`Failed to create Cashfree order: ${orderResult.error}`)
  }

  const paymentPageUrl = buildTokenPaymentPageUrl(appBaseUrl, crqid)

  const sendResult = await sendWhatsAppCtaUrlMessage(
    touristPhone,
    copy.bodyText,
    { title: BALANCE_PAY_BUTTON_TITLE, url: paymentPageUrl },
    { footerText: copy.footerText },
  )

  console.info("[balance pay] send result", {
    bookingId,
    success: sendResult.success,
    configured: sendResult.configured,
    error: sendResult.error ?? null,
    waMessageId: sendResult.waMessageId ?? null,
  })

  if (!sendResult.success) {
    await supabase
      .from("whatsapp_payment_intents")
      .update({ last_error: sendResult.error ?? "cta_url_send_failed" })
      .eq("id", crqid)
      .in("status", ["pending", "sent"])
    throw new Error(`Failed to send balance payment link: ${sendResult.error}`)
  }

  const { error: intentUpdateError } = await supabase
    .from("whatsapp_payment_intents")
    .update({
      status: "sent",
      wa_message_id: sendResult.waMessageId ?? null,
      last_error: null,
      payment_link_url: paymentPageUrl,
    })
    .eq("id", crqid)
    .neq("status", "paid")
  if (intentUpdateError && !isMissingRelation(intentUpdateError)) {
    throw new Error(`Failed to mark balance intent sent: ${intentUpdateError.message}`)
  }

  const { error: logError } = await supabase.from("whatsapp_message_log").insert({
    booking_id: bookingId,
    trip_request_id: booking.trip_request_id,
    quote_snapshot_id: booking.winning_quote_snapshot_id,
    tourist_id: booking.tourist_id,
    vendor_id: booking.vendor_id,
    direction: "outbound",
    body_snapshot: copy.bodyText,
    button_payload: JSON.stringify({
      templateKey: DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY,
      sendMethod: "session_cta_url",
      crqid,
      amountInr: balanceDue,
      linkUrl: paymentPageUrl,
      media: {
        cardImageUrl: headerImageUrl,
        attempted: mediaCardResult.attempted,
        sent: mediaCardResult.sent,
        waMessageId: mediaCardResult.waMessageId,
        error: mediaCardResult.error,
      },
    }),
    wa_message_id: sendResult.waMessageId ?? null,
    wa_status: "sent",
    template_name: DRIVER_ASSIGNED_PAYMENT_TEMPLATE_KEY,
  })

  if (logError && logError.code !== DUPLICATE_KEY_ERROR_CODE) {
    throw new Error(`Failed to log balance payment link: ${logError.message}`)
  }
}

const upsertBalanceIntent = async (
  supabase: SupabaseClient,
  input: {
    bookingId: string
    quoteSnapshotId: string
    tripRequestId: string
    touristId: string
    vendorId: string
    customerNumber: string
    amountInr: number
  },
): Promise<{ crqid: string; intentReady: boolean; alreadySent: boolean }> => {
  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_payment_intents")
    .select("id, status")
    .eq("booking_id", input.bookingId)
    .eq("purpose", "balance")
    .in("status", ["pending", "sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) {
    if (isMissingRelation(existingError) || existingError.message.toLowerCase().includes("purpose")) {
      return { crqid: input.bookingId, intentReady: false, alreadySent: false }
    }
    throw new Error(`Failed to load balance intent: ${existingError.message}`)
  }

  if (existing?.id) {
    return {
      crqid: existing.id as string,
      intentReady: true,
      alreadySent: existing.status === "sent",
    }
  }

  const intentId = randomUUID()
  const { error: insertError } = await supabase.from("whatsapp_payment_intents").insert({
    id: intentId,
    quote_snapshot_id: input.quoteSnapshotId,
    trip_request_id: input.tripRequestId,
    tourist_id: input.touristId,
    vendor_id: input.vendorId,
    booking_id: input.bookingId,
    customer_number: input.customerNumber,
    amount_inr: input.amountInr,
    purpose: "balance",
    status: "pending",
    crqid: intentId,
  })

  if (insertError) {
    if (isMissingRelation(insertError) || insertError.message.toLowerCase().includes("purpose")) {
      return { crqid: input.bookingId, intentReady: false, alreadySent: false }
    }
    if (insertError.code === DUPLICATE_KEY_ERROR_CODE) {
      const { data: raced } = await supabase
        .from("whatsapp_payment_intents")
        .select("id, status")
        .eq("booking_id", input.bookingId)
        .eq("purpose", "balance")
        .in("status", ["pending", "sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (raced?.id) {
        return {
          crqid: raced.id as string,
          intentReady: true,
          alreadySent: raced.status === "sent",
        }
      }
    }
    throw new Error(`Failed to create balance intent: ${insertError.message}`)
  }

  return { crqid: intentId, intentReady: true, alreadySent: false }
}
