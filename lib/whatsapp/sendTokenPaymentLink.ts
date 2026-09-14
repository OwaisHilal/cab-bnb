import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { stripE164Plus } from "@/lib/msg91/pure"
import { TOKEN_LOCK_AMOUNT } from "@/lib/whatsapp/formatInr"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import { sendWhatsAppPaymentLinkMessageWithHeaderRetry, sendWhatsAppTextMessage } from "@/lib/whatsapp/sendOutbound"
import {
  TOKEN_LOCK_PAYMENT_TEMPLATE_KEY,
  buildTokenPaymentLinkCopy,
} from "@/lib/whatsapp/tokenPaymentLink"

export interface SendTokenPaymentLinkPayload {
  quote_snapshot_id: string
  wa_message_id?: string
}

interface QuoteSnapshotRow {
  id: string
  trip_request_id: string
  vendor_id: string
  current_quote: number
  status: string
  vendors:
    | { business_name: string; reliability_score: number | null }
    | { business_name: string; reliability_score: number | null }[]
    | null
  vehicle_types: { label: string } | { label: string }[] | null
  trip_requests:
    | TripRequestEmbed
    | TripRequestEmbed[]
    | null
}

interface TripRequestEmbed {
  id: string
  tourist_id: string | null
  pickup_location: string | null
  drop_location: string | null
  trip_start_date: string
  trip_days: number
  pax_count: number
  tourists: { phone_e164: string } | { phone_e164: string }[] | null
  requested_vehicle_type: { label: string } | { label: string }[] | null
}

interface PaymentIntentRow {
  id: string
  status: string
}

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

/**
 * After the tourist taps Select {vendor} (`BOOK_TOKEN::`), send MSG91
 * WhatsApp Payments `payment_link` for a fixed ₹99 Cashfree cart.
 * Must stay inside the 24h session opened by quote_choice_v1.
 */
export const handleSendTokenPaymentLink = async (
  supabase: SupabaseClient,
  payload: SendTokenPaymentLinkPayload,
): Promise<void> => {
  const quoteSnapshotId = payload.quote_snapshot_id
  if (!quoteSnapshotId) {
    throw new Error("send_token_payment_link requires quote_snapshot_id")
  }

  // DEBUG (session fdcd5f): confirmed via runtime log that this flag reads
  // "1" correctly on Production. Re-enabling the swap branch below so the
  // rest of the send pipeline (intent bookkeeping, message log insert,
  // wa_message_id handling) can be exercised without going through the
  // Cashfree-blocked payment_link call, to check for any other bugs.
  // Remove this flag + branch once that check is done.
  const DEBUG_SEND_TEXT_INSTEAD_OF_PAYMENT_LINK = process.env.DEBUG_TOKEN_PAY_SEND_TEXT_INSTEAD?.trim() === "1"
  console.info("[debug env check]", {
    debugFlagRaw: JSON.stringify(process.env.DEBUG_TOKEN_PAY_SEND_TEXT_INSTEAD ?? null),
    diagnosticMode: DEBUG_SEND_TEXT_INSTEAD_OF_PAYMENT_LINK,
    vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  })

  await ensureMessageTemplates(supabase)

  const { data: snapshot, error: snapshotError } = await supabase
    .from("quote_snapshots")
    .select(
      "id, trip_request_id, vendor_id, current_quote, status, vendors(business_name, reliability_score), vehicle_types(label), trip_requests(id, tourist_id, pickup_location, drop_location, trip_start_date, trip_days, pax_count, tourists(phone_e164), requested_vehicle_type:vehicle_types!requested_vehicle_type_id(label))",
    )
    .eq("id", quoteSnapshotId)
    .maybeSingle()

  if (snapshotError) throw new Error(`Failed to fetch quote snapshot: ${snapshotError.message}`)
  if (!snapshot) throw new Error(`quote_snapshot ${quoteSnapshotId} not found`)

  const row = snapshot as unknown as QuoteSnapshotRow
  if (row.status === "finalized" || row.status === "lost" || row.status === "expired") {
    console.info("[token pay] skipped closed quote", { quoteSnapshotId, quoteStatus: row.status })
    return
  }

  const trip = firstOrSelf(row.trip_requests)
  if (!trip) throw new Error(`quote_snapshot ${quoteSnapshotId} has no trip_request`)

  const touristPhone = firstOrSelf(trip.tourists)?.phone_e164
  if (!touristPhone) {
    throw new Error(`trip_request ${trip.id} has no verified tourist phone`)
  }

  const vendor = firstOrSelf(row.vendors)
  const vehicleLabel =
    firstOrSelf(trip.requested_vehicle_type)?.label ??
    firstOrSelf(row.vehicle_types)?.label ??
    "Cab"
  const copy = buildTokenPaymentLinkCopy({
    trip: {
      tripDays: trip.trip_days,
      paxCount: trip.pax_count,
      vehicleLabel,
      pickupLocation: trip.pickup_location,
      dropLocation: trip.drop_location,
      tripStartDate: trip.trip_start_date,
    },
    vendor: {
      vendorName: vendor?.business_name ?? "Vendor",
      pricePerDay: Number(row.current_quote),
      rating: vendor?.reliability_score ?? null,
    },
  })

  const customerNumber = stripE164Plus(touristPhone)
  const headerImageUrl = process.env.MSG91_PAYMENT_LINK_HEADER_IMAGE_URL?.trim()
  const { crqid, intentReady, alreadySent } = await upsertPaymentIntent(supabase, {
    quoteSnapshotId,
    tripRequestId: trip.id,
    touristId: trip.tourist_id,
    vendorId: row.vendor_id,
    customerNumber,
  })

  // DEBUG (session fdcd5f): lets you re-test send_token_payment_link on a
  // quote you've already tapped "Select" on, instead of requiring a brand
  // new trip request each time. Remove this flag + branch once testing is
  // done.
  const DEBUG_ALLOW_RESEND = process.env.DEBUG_TOKEN_PAY_ALLOW_RESEND?.trim() === "1"
  if (alreadySent && !DEBUG_ALLOW_RESEND) {
    console.info("[token pay] skipped already sent", { quoteSnapshotId })
    return
  }
  if (alreadySent && DEBUG_ALLOW_RESEND) {
    console.info("[token pay] already sent, but DEBUG_TOKEN_PAY_ALLOW_RESEND=1 — resending", { quoteSnapshotId })
  }

  const sendResult = DEBUG_SEND_TEXT_INSTEAD_OF_PAYMENT_LINK
    ? await sendWhatsAppTextMessage(
        touristPhone,
        `[DIAGNOSTIC] Pipeline reached send step for ${vendor?.business_name ?? "vendor"}. crqid: ${crqid}`,
      )
    : await sendWhatsAppPaymentLinkMessageWithHeaderRetry({
        toE164: touristPhone,
        bodyText: copy.bodyText,
        footerText: copy.footerText,
        headerImageUrl: headerImageUrl || undefined,
        items: [{ name: copy.itemName, amount: copy.amountInr, quantity: copy.quantity }],
        crqid,
      })

  console.info("[token pay] send result", {
    quoteSnapshotId,
    diagnosticMode: DEBUG_SEND_TEXT_INSTEAD_OF_PAYMENT_LINK,
    success: sendResult.success,
    configured: sendResult.configured,
    error: sendResult.error ?? null,
    waMessageId: sendResult.waMessageId ?? null,
  })

  if (!sendResult.success) {
    console.error("[token pay] send failed", {
      quoteSnapshotId,
      diagnosticMode: DEBUG_SEND_TEXT_INSTEAD_OF_PAYMENT_LINK,
      configured: sendResult.configured,
      error: sendResult.error ?? null,
    })
    if (intentReady) {
      await supabase
        .from("whatsapp_payment_intents")
        .update({ last_error: sendResult.error ?? "payment_link_send_failed" })
        .eq("id", crqid)
        .in("status", ["pending", "sent"])
    }
    throw new Error(
      DEBUG_SEND_TEXT_INSTEAD_OF_PAYMENT_LINK
        ? `Failed to send diagnostic text: ${sendResult.error}`
        : `Failed to send ₹99 payment link: ${sendResult.error}`,
    )
  }

  if (intentReady) {
    const { error: intentUpdateError } = await supabase
      .from("whatsapp_payment_intents")
      .update({
        status: "sent",
        wa_message_id: sendResult.waMessageId ?? null,
        last_error: null,
      })
      .eq("id", crqid)
      .neq("status", "paid")

    if (intentUpdateError && !isMissingRelation(intentUpdateError)) {
      throw new Error(`Failed to mark payment intent sent: ${intentUpdateError.message}`)
    }
  }

  const { error: logError } = await supabase.from("whatsapp_message_log").insert({
    trip_request_id: trip.id,
    quote_snapshot_id: quoteSnapshotId,
    tourist_id: trip.tourist_id,
    vendor_id: row.vendor_id,
    direction: "outbound",
    body_snapshot: copy.bodyText,
    button_payload: JSON.stringify({
      templateKey: TOKEN_LOCK_PAYMENT_TEMPLATE_KEY,
      sendMethod: "session_payment_link",
      crqid,
      amountInr: TOKEN_LOCK_AMOUNT,
      items: [{ name: copy.itemName, amount: copy.amountInr, quantity: copy.quantity }],
    }),
    wa_message_id: sendResult.waMessageId ?? null,
    wa_status: "sent",
    template_name: TOKEN_LOCK_PAYMENT_TEMPLATE_KEY,
  })

  if (logError) {
    if (logError.code === DUPLICATE_KEY_ERROR_CODE) return
    throw new Error(`Failed to log payment link message: ${logError.message}`)
  }
}

const upsertPaymentIntent = async (
  supabase: SupabaseClient,
  input: {
    quoteSnapshotId: string
    tripRequestId: string
    touristId: string | null
    vendorId: string
    customerNumber: string
  },
): Promise<{ crqid: string; intentReady: boolean; alreadySent: boolean }> => {
  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_payment_intents")
    .select("id, status")
    .eq("quote_snapshot_id", input.quoteSnapshotId)
    .in("status", ["pending", "sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) {
    if (isMissingRelation(existingError)) {
      return { crqid: input.quoteSnapshotId, intentReady: false, alreadySent: false }
    }
    throw new Error(`Failed to load payment intent: ${existingError.message}`)
  }

  const existingRow = existing as PaymentIntentRow | null
  if (existingRow?.id) {
    return {
      crqid: existingRow.id,
      intentReady: true,
      alreadySent: existingRow.status === "sent",
    }
  }

  const intentId = randomUUID()
  const { error: insertError } = await supabase.from("whatsapp_payment_intents").insert({
    id: intentId,
    quote_snapshot_id: input.quoteSnapshotId,
    trip_request_id: input.tripRequestId,
    tourist_id: input.touristId,
    vendor_id: input.vendorId,
    customer_number: input.customerNumber,
    amount_inr: TOKEN_LOCK_AMOUNT,
    status: "pending",
    crqid: intentId,
  })

  if (insertError) {
    if (isMissingRelation(insertError)) {
      return { crqid: input.quoteSnapshotId, intentReady: false, alreadySent: false }
    }
    if (insertError.code === DUPLICATE_KEY_ERROR_CODE) {
      const { data: raced } = await supabase
        .from("whatsapp_payment_intents")
        .select("id")
        .eq("quote_snapshot_id", input.quoteSnapshotId)
        .in("status", ["pending", "sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (raced?.id) {
        return { crqid: raced.id as string, intentReady: true, alreadySent: false }
      }
    }
    throw new Error(`Failed to create payment intent: ${insertError.message}`)
  }

  return { crqid: intentId, intentReady: true, alreadySent: false }
}
