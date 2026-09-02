import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { parseInboundAction } from "@/lib/whatsapp/webhook/parseInboundAction"
import { parseWhatsAppMessageLogPayload, serializeWhatsAppMessageLogPayload } from "@/lib/whatsapp/messagePayload"
import { serializeMockChatPayload } from "@/lib/demo/mockChatPayload"
import type { WhatsAppButton } from "@/lib/whatsapp/types"

import type { MockMessagingThread } from "@/features/demo/types"
import {
  classifyMessagingAudience,
  classifyMessagingKind,
  inferFlowStepId,
} from "@/features/admin-debug/messagingFlow"
import {
  calculateDemoTripTotal,
  formatDemoInr,
  runDemoCompleteBalancePayment,
  runDemoCompleteFullBookingPayment,
  runDemoPostTokenBookingFlow,
} from "@/lib/demo/postTokenBookingFlow"

function isCustomerFacingMessage(row: Record<string, unknown>): boolean {
  const templateName = row.template_name as string | null
  if (templateName === "driver_assignment_v1") return false
  if (templateName === "vendor_booking_notify_v1") return false
  if (templateName === "vendor_inbound_driver_reply") return false
  if (row.vendor_id) return false
  return true
}

export async function loadMockMessagingThread(
  supabase: SupabaseClient,
  tripRequestId: string,
  options?: { includeVendorMessages?: boolean; includeAllAudiences?: boolean },
): Promise<MockMessagingThread | null> {
  const { data: tripRequest, error: tripError } = await supabase
    .from("trip_requests")
    .select("id, tourist:tourists(phone_e164)")
    .eq("id", tripRequestId)
    .maybeSingle()

  if (tripError || !tripRequest) return null

  const tourist = Array.isArray(tripRequest.tourist) ? tripRequest.tourist[0] : tripRequest.tourist
  const touristPhone = (tourist as { phone_e164?: string } | null)?.phone_e164 ?? null

  let rows: Array<Record<string, unknown>> = []

  if (options?.includeAllAudiences) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id")
      .eq("trip_request_id", tripRequestId)

    const bookingIds = (bookings ?? []).map((row) => row.id as string)
    const bookingFilter =
      bookingIds.length > 0 ? `,booking_id.in.(${bookingIds.join(",")})` : ""

    const { data: allRows, error: allError } = await supabase
      .from("whatsapp_message_log")
      .select(
        "id, direction, body_snapshot, button_payload, template_name, wa_status, created_at, vendor_id, booking_id, tourist_id",
      )
      .or(`trip_request_id.eq.${tripRequestId}${bookingFilter}`)
      .order("created_at", { ascending: true })

    if (allError) {
      throw new Error(`Failed to load messaging thread: ${allError.message}`)
    }
    rows = allRows ?? []
  } else {
    const { data: tripRows, error: logError } = await supabase
      .from("whatsapp_message_log")
      .select(
        "id, direction, body_snapshot, button_payload, template_name, wa_status, created_at, vendor_id, booking_id, tourist_id",
      )
      .eq("trip_request_id", tripRequestId)
      .order("created_at", { ascending: true })

    if (logError) {
      throw new Error(`Failed to load messaging thread: ${logError.message}`)
    }

    rows = options?.includeVendorMessages
      ? tripRows ?? []
      : (tripRows ?? []).filter((row) => isCustomerFacingMessage(row))
  }

  return {
    trip_request_id: tripRequestId,
    tourist_phone: touristPhone,
    messages: rows.map((row) => {
      const payload = parseWhatsAppMessageLogPayload(row.button_payload as string | null)
      const listButtons =
        payload.list?.sections.flatMap((section) =>
          section.rows.map((listRow) => ({ id: listRow.id, title: listRow.title })),
        ) ?? []

      const templateName = row.template_name as string | null
      const vendorId = row.vendor_id as string | null
      const direction = row.direction as "outbound" | "inbound"
      const bodySnapshot = row.body_snapshot as string | null
      const audience = classifyMessagingAudience({
        template_name: templateName,
        vendor_id: vendorId,
        tourist_id: row.tourist_id as string | null,
        direction,
      })
      const messageKind = classifyMessagingKind(row.button_payload as string | null)

      const rawButtons = payload.buttons.length > 0 ? payload.buttons : listButtons
      const buttons = audience === "driver" ? [] : rawButtons

      let recipientHint: string | null = null
      if (audience === "customer") recipientHint = touristPhone
      if (audience === "vendor") recipientHint = "Vendor WhatsApp (e.g. Nova +919999900001)"
      if (audience === "driver") {
        try {
          const meta = JSON.parse((row.button_payload as string | null) ?? "{}") as {
            recipientPhone?: string
          }
          recipientHint = meta.recipientPhone ?? "Driver WhatsApp"
        } catch {
          recipientHint = "Driver WhatsApp"
        }
      }

      return {
        id: row.id as string,
        direction,
        body_snapshot: bodySnapshot,
        button_payload: row.button_payload as string | null,
        buttons,
        media: payload.media ?? null,
        template_name: templateName,
        wa_status: row.wa_status as string | null,
        created_at: row.created_at as string,
        vendor_id: vendorId,
        booking_id: row.booking_id as string | null,
        audience,
        message_kind: messageKind,
        flow_step_id: inferFlowStepId({
          template_name: templateName,
          vendor_id: vendorId,
          direction,
          body_snapshot: bodySnapshot,
        }),
        recipient_hint: recipientHint,
      }
    }),
  }
}

async function logMockMessage(
  supabase: SupabaseClient,
  input: {
    tripRequestId: string
    quoteSnapshotId?: string
    direction: "outbound" | "inbound"
    body: string
    buttons?: WhatsAppButton[]
    buttonPayload?: string
    interactionType?: "button_click" | "free_text"
    waStatus?: string
  },
): Promise<void> {
  const { error } = await supabase.from("whatsapp_message_log").insert({
    trip_request_id: input.tripRequestId,
    quote_snapshot_id: input.quoteSnapshotId ?? null,
    direction: input.direction,
    body_snapshot: input.body,
    button_payload: input.buttons
      ? serializeMockChatPayload({ buttons: input.buttons })
      : (input.buttonPayload ?? null),
    interaction_type: input.interactionType ?? null,
    wa_message_id: `demo-${randomUUID()}`,
    wa_status: input.waStatus ?? "sent",
    template_name: "demo_mock_chat",
  })

  if (error) {
    throw new Error(`Failed to log mock message: ${error.message}`)
  }
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export type MockMessagingActionResult =
  | { ok: true; kind: "negotiate"; next_quote: number; is_final: boolean }
  | { ok: true; kind: "book"; booking_ref: string; lock_type: "full_payment" | "token_99"; booking_id: string }
  | { ok: true; kind: "complete_payment"; booking_id: string }
  | { ok: false; status: number; message: string }

export async function handleMockMessagingAction(
  supabase: SupabaseClient,
  tripRequestId: string,
  buttonPayload: string,
  buttonTitle?: string,
): Promise<MockMessagingActionResult> {
  const action = parseInboundAction({
    waMessageId: `demo-in-${randomUUID()}`,
    fromPhone: "",
    timestamp: new Date().toISOString(),
    type: "button",
    textBody: null,
    buttonPayload,
    interactionType: "button_click",
  })

  await logMockMessage(supabase, {
    tripRequestId,
    direction: "inbound",
    body: buttonTitle ? `Tapped: ${buttonTitle}` : `Tapped: ${buttonPayload}`,
    buttonPayload,
    interactionType: "button_click",
    waStatus: "replied",
  })

  if (action.type === "negotiate") {
    const quoteSnapshotId = action.quoteSnapshotId
    const { data, error } = await supabase
      .rpc("compute_negotiation", { p_quote_snapshot_id: quoteSnapshotId })
      .single<{ next_quote: number; is_final: boolean; negotiation_round: number }>()

    if (error) {
      if (error.message.includes("quote_snapshot_not_negotiable")) {
        return { ok: false, status: 409, message: "This quote is no longer open for negotiation" }
      }
      return { ok: false, status: 500, message: error.message }
    }
    if (!data) {
      return { ok: false, status: 500, message: "Negotiation returned no result" }
    }

    const bodyText = data.is_final
      ? `This is our best possible price: \u20b9${data.next_quote}/day. Final offer.`
      : `Here's our next offer: \u20b9${data.next_quote}/day.`

    const buttons: WhatsAppButton[] = [
      { id: `BOOK_TOKEN::${quoteSnapshotId}`, title: "Pay \u20b999 to Lock" },
    ]

    await logMockMessage(supabase, {
      tripRequestId,
      quoteSnapshotId,
      direction: "outbound",
      body: bodyText,
      buttons,
    })

    await supabase.from("trip_requests").update({ status: "negotiating" }).eq("id", tripRequestId)

    return { ok: true, kind: "negotiate", next_quote: data.next_quote, is_final: data.is_final }
  }

  if (action.type === "book_full" || action.type === "book_token") {
    const lockType = action.type === "book_full" ? "full_payment" : "token_99"
    const quoteSnapshotId = action.quoteSnapshotId

    const { data, error } = await supabase
      .rpc("finalize_quote_booking", {
        p_quote_snapshot_id: quoteSnapshotId,
        p_lock_type: lockType,
      })
      .single<{ booking_id: string; booking_ref: string }>()

    if (error) {
      if (error.message.includes("quote_snapshot_not_negotiable")) {
        return { ok: false, status: 409, message: "This quote is no longer available to book" }
      }
      return { ok: false, status: 500, message: error.message }
    }
    if (!data) {
      return { ok: false, status: 500, message: "Booking finalize returned no result" }
    }

    const { data: snapshot } = await supabase
      .from("quote_snapshots")
      .select("vendors(business_name)")
      .eq("id", quoteSnapshotId)
      .maybeSingle()

    const vendorName = firstOrSelf(
      (snapshot as { vendors: { business_name: string } | { business_name: string }[] | null } | null)?.vendors,
    )?.business_name

    const { data: bookingRow, error: bookingRowError } = await supabase
      .from("bookings")
      .select("final_quote, trip_days, lock_type")
      .eq("id", data.booking_id)
      .maybeSingle()

    if (bookingRowError || !bookingRow) {
      return { ok: false, status: 500, message: "Booking created but pricing details missing" }
    }

    if (lockType === "full_payment") {
      await supabase
        .from("bookings")
        .update({ payment_status: "partially_paid" })
        .eq("id", data.booking_id)

      const tripDays = bookingRow.trip_days as number
      const finalQuote = (bookingRow.final_quote as number | null) ?? 0
      const totalDue = calculateDemoTripTotal(finalQuote, tripDays)
      const dayLabel = tripDays === 1 ? "day" : "days"
      const bodyText = [
        `Booking confirmed! Ref ${data.booking_ref}.`,
        vendorName ? `Operator: ${vendorName}.` : "",
        `${tripDays} ${dayLabel} × ${formatDemoInr(finalQuote)}/day`,
        `Total due: ${formatDemoInr(totalDue)}`,
        "Complete payment here to assign your driver.",
      ]
        .filter(Boolean)
        .join("\n")

      await logMockMessage(supabase, {
        tripRequestId,
        quoteSnapshotId,
        direction: "outbound",
        body: bodyText,
        buttons: [{ id: `COMPLETE_PAYMENT::${data.booking_id}`, title: `Pay ${formatDemoInr(totalDue)} Now` }],
      })
    } else {
      const bodyText = [
        `Booking confirmed! Ref ${data.booking_ref}.`,
        vendorName ? `Operator: ${vendorName}.` : "",
        "\u20b999 token received — driver details follow shortly.",
      ]
        .filter(Boolean)
        .join("\n")

      await logMockMessage(supabase, {
        tripRequestId,
        quoteSnapshotId,
        direction: "outbound",
        body: bodyText,
      })

      await runDemoPostTokenBookingFlow(supabase, data.booking_id, tripRequestId)
    }

    return {
      ok: true,
      kind: "book",
      booking_ref: data.booking_ref,
      lock_type: lockType,
      booking_id: data.booking_id,
    }
  }

  if (action.type === "complete_payment") {
    const bookingId = action.bookingId
    if (!bookingId) {
      return { ok: false, status: 400, message: "Missing booking id for payment" }
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, trip_request_id, payment_status, lock_type, status")
      .eq("id", bookingId)
      .maybeSingle()

    if (bookingError) {
      return { ok: false, status: 500, message: bookingError.message }
    }
    if (!booking || booking.trip_request_id !== tripRequestId) {
      return { ok: false, status: 404, message: "Booking not found for this trip" }
    }
    if (booking.payment_status === "fully_paid" && booking.status !== "vendor_confirming") {
      return { ok: true, kind: "complete_payment", booking_id: bookingId }
    }

    if (booking.lock_type === "full_payment" && booking.status === "vendor_confirming") {
      await runDemoCompleteFullBookingPayment(supabase, tripRequestId, bookingId)
      return { ok: true, kind: "complete_payment", booking_id: bookingId }
    }

    await runDemoCompleteBalancePayment(supabase, tripRequestId, bookingId)

    return { ok: true, kind: "complete_payment", booking_id: bookingId }
  }

  return { ok: false, status: 400, message: "Unsupported mock action" }
}
