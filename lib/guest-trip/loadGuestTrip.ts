import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { calculateBalanceDue } from "@/lib/whatsapp/balancePaymentLink"
import { buildBalancePaymentLinkCopy } from "@/lib/whatsapp/balancePaymentLink"
import { ensureMessageTemplates, renderMessageTemplate, getMessageTemplate } from "@/lib/whatsapp/messageTemplateStore"
import {
  QUOTE_CHOICE_FOOTER,
  QUOTE_CHOICE_MAX_QUOTES,
  formatQuoteChoiceLine,
  formatQuoteChoiceTripSummary,
} from "@/lib/whatsapp/quoteChoiceTemplate"
import { buildDriverContactMessage } from "@/lib/whatsapp/templateCatalog"
import { buildQuoteChoiceMessage, buildQuoteSingleMessage } from "@/lib/whatsapp/templateCatalog"
import { buildTokenReceivedAckMessage } from "@/lib/whatsapp/tokenReceivedAck"
import { TOKEN_LOCK_PAYMENT_FOOTER, buildTokenPaymentLinkCopy } from "@/lib/whatsapp/tokenPaymentLink"
import { deriveGuestStep, isTripInProgress } from "@/lib/guest-trip/deriveGuestStep"
import { pickCurrentGuestTrip } from "@/lib/guest-trip/pickCurrentGuestTrip"
import type { GuestPaymentIntentStatus, GuestStep, GuestStepInput, GuestTripSnapshot } from "@/lib/guest-trip/types"

export type GuestConfirming = "token" | "balance" | null

const OPEN_INTENT_STATUSES = ["pending", "sent", "paid"] as const
const CLOSED_TRIP_STATUSES = new Set(["abandoned", "expired"])
const QUOTE_SKIP_STATUSES = new Set(["lost", "expired"])

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

const isMissingRelation = (error: { code?: string; message: string }): boolean => {
  const code = error.code ?? ""
  const message = error.message.toLowerCase()
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  )
}

const asIntentStatus = (status: string | null | undefined): GuestPaymentIntentStatus => {
  if (status === "pending" || status === "sent" || status === "paid" || status === "failed" || status === "expired") {
    return status
  }
  return "none"
}

interface TripRow {
  id: string
  status: string
  created_at: string
  trip_days: number
  pax_count: number
  pickup_location: string | null
  drop_location: string | null
  trip_start_date: string
  requested_vehicle_type: { label: string } | { label: string }[] | null
}

interface QuoteRow {
  id: string
  current_quote: number
  status: string
  vendors:
    | { business_name: string; reliability_score: number | null }
    | { business_name: string; reliability_score: number | null }[]
    | null
  vehicle_types: { label: string } | { label: string }[] | null
}

interface IntentRow {
  id: string
  status: string
  purpose: string
  quote_snapshot_id: string | null
  booking_id: string | null
  created_at: string
}

interface BookingRow {
  id: string
  status: string
  payment_status: string
  driver_id: string | null
  final_quote: number | null
  trip_days: number
  pax_count: number
  winning_quote_snapshot_id: string | null
  drivers: { full_name: string; phone_e164: string } | { full_name: string; phone_e164: string }[] | null
  vehicles:
    | { model: string | null; registration_number: string | null }
    | { model: string | null; registration_number: string | null }[]
    | null
  vendors:
    | { business_name: string; reliability_score: number | null }
    | { business_name: string; reliability_score: number | null }[]
    | null
}

interface DriverDetailRow {
  parsed_driver_name: string | null
  parsed_driver_phone: string | null
  parsed_vehicle_number: string | null
  parsed_vehicle_model: string | null
}

const tripSelect =
  "id, status, created_at, trip_days, pax_count, pickup_location, drop_location, trip_start_date, requested_vehicle_type:vehicle_types!requested_vehicle_type_id(label)"

export const listTripIdsForGuestSession = async (
  supabase: SupabaseClient,
  sessionId: string,
): Promise<string[]> => {
  const ids = new Set<string>()

  const { data: owned, error: ownedError } = await supabase
    .from("trip_requests")
    .select("id")
    .eq("session_id", sessionId)

  if (ownedError) throw new Error(`Failed to fetch trip requests: ${ownedError.message}`)
  for (const row of owned ?? []) ids.add(row.id as string)

  const { data: linked, error: linkedError } = await supabase
    .from("guest_trip_sessions")
    .select("trip_request_id")
    .eq("session_id", sessionId)

  if (linkedError) {
    if (!isMissingRelation(linkedError)) {
      throw new Error(`Failed to fetch guest trip sessions: ${linkedError.message}`)
    }
  } else {
    for (const row of linked ?? []) ids.add(row.trip_request_id as string)
  }

  return [...ids]
}

export const sessionCanReadTrip = async (
  supabase: SupabaseClient,
  sessionId: string,
  tripRequestId: string,
): Promise<boolean> => {
  const ids = await listTripIdsForGuestSession(supabase, sessionId)
  return ids.includes(tripRequestId)
}

const footerForStep = (step: GuestStep): string | null => {
  if (step === "quotes" || step === "quotes_waiting") return step === "quotes" ? QUOTE_CHOICE_FOOTER : null
  if (step === "lock") return TOKEN_LOCK_PAYMENT_FOOTER
  if (step === "balance") return "Pay remaining balance to confirm."
  return null
}

export const loadGuestTrip = async (
  supabase: SupabaseClient,
  input: {
    sessionId: string
    confirming: GuestConfirming
    previewStep?: "token_received" | "driver_contact" | null
  },
): Promise<GuestTripSnapshot | null> => {
  const tripIds = await listTripIdsForGuestSession(supabase, input.sessionId)
  if (tripIds.length === 0) return null

  const { data: tripRows, error: tripError } = await supabase.from("trip_requests").select(tripSelect).in("id", tripIds)
  if (tripError) throw new Error(`Failed to fetch trip requests: ${tripError.message}`)

  const trips = (tripRows ?? []) as unknown as TripRow[]
  if (trips.length === 0) return null

  const { data: quoteRows, error: quoteError } = await supabase
    .from("quote_snapshots")
    .select("id, trip_request_id, current_quote, status")
    .in("trip_request_id", tripIds)
    .order("current_quote", { ascending: true })

  if (quoteError) throw new Error(`Failed to fetch quote snapshots: ${quoteError.message}`)

  const { data: intentRows, error: intentError } = await supabase
    .from("whatsapp_payment_intents")
    .select("id, status, purpose, quote_snapshot_id, booking_id, trip_request_id, created_at")
    .in("trip_request_id", tripIds)
    .in("status", [...OPEN_INTENT_STATUSES])
    .order("created_at", { ascending: true })

  if (intentError && !isMissingRelation(intentError)) {
    throw new Error(`Failed to fetch payment intents: ${intentError.message}`)
  }

  const { data: bookingRows, error: bookingError } = await supabase
    .from("bookings")
    .select("id, trip_request_id, status, payment_status, driver_id, created_at")
    .in("trip_request_id", tripIds)
    .order("created_at", { ascending: false })

  if (bookingError) throw new Error(`Failed to fetch bookings: ${bookingError.message}`)

  const quotesByTrip = new Map<string, Array<{ id: string; status: string }>>()
  for (const quote of quoteRows ?? []) {
    const tripRequestId = quote.trip_request_id as string
    const list = quotesByTrip.get(tripRequestId) ?? []
    list.push({ id: quote.id as string, status: quote.status as string })
    quotesByTrip.set(tripRequestId, list)
  }

  const intentsByTrip = new Map<string, IntentRow[]>()
  for (const intent of (intentError ? [] : intentRows ?? []) as unknown as Array<IntentRow & { trip_request_id: string }>) {
    const list = intentsByTrip.get(intent.trip_request_id) ?? []
    list.push(intent)
    intentsByTrip.set(intent.trip_request_id, list)
  }

  const bookingByTrip = new Map<string, { id: string; payment_status: string; driver_id: string | null; status: string }>()
  for (const booking of bookingRows ?? []) {
    const tripRequestId = booking.trip_request_id as string
    if (!bookingByTrip.has(tripRequestId)) {
      bookingByTrip.set(tripRequestId, {
        id: booking.id as string,
        payment_status: booking.payment_status as string,
        driver_id: (booking.driver_id as string | null) ?? null,
        status: booking.status as string,
      })
    }
  }

  const candidates = trips.map((trip) => {
    const quoteCount = (quotesByTrip.get(trip.id) ?? []).filter((quote) => !QUOTE_SKIP_STATUSES.has(quote.status)).length
    const intents = intentsByTrip.get(trip.id) ?? []
    const tokenIntent = intents.find((intent) => intent.purpose === "token_lock")
    const booking = bookingByTrip.get(trip.id) ?? null
    const balanceIntent = booking
      ? intents.find((intent) => intent.purpose === "balance" && intent.booking_id === booking.id)
      : undefined
    const stepInput: GuestStepInput = {
      tripRequestStatus: trip.status,
      quoteCount,
      tokenIntentStatus: asIntentStatus(tokenIntent?.status),
      driverAssigned: Boolean(booking?.driver_id),
      balanceIntentStatus: asIntentStatus(balanceIntent?.status),
      balanceConfirmed: booking?.payment_status === "fully_paid",
    }
    const step = deriveGuestStep(stepInput)
    return {
      id: trip.id,
      createdAt: trip.created_at,
      inProgress: isTripInProgress(stepInput),
      finished: step === "driver_contact",
      closed: CLOSED_TRIP_STATUSES.has(trip.status) || step === "closed",
      trip,
      stepInput,
    }
  })

  const picked = pickCurrentGuestTrip(candidates)
  if (!picked) return null

  await ensureMessageTemplates(supabase)
  return buildSnapshot(supabase, picked.trip, picked.stepInput, input.confirming, input.previewStep ?? null)
}

const buildSnapshot = async (
  supabase: SupabaseClient,
  trip: TripRow,
  stepInput: GuestStepInput,
  confirming: GuestConfirming,
  previewStep: "token_received" | "driver_contact" | null,
): Promise<GuestTripSnapshot> => {
  const vehicleLabel = firstOrSelf(trip.requested_vehicle_type)?.label ?? "Cab"
  const tripSummary = formatQuoteChoiceTripSummary({
    tripDays: trip.trip_days,
    paxCount: trip.pax_count,
    vehicleLabel,
    pickupLocation: trip.pickup_location,
    dropLocation: trip.drop_location,
  })

  const { data: quoteData, error: quoteError } = await supabase
    .from("quote_snapshots")
    .select("id, current_quote, status, vendors(business_name, reliability_score), vehicle_types(label)")
    .eq("trip_request_id", trip.id)
    .order("current_quote", { ascending: true })

  if (quoteError) throw new Error(`Failed to fetch quote snapshots: ${quoteError.message}`)

  const quotes = ((quoteData ?? []) as unknown as QuoteRow[])
    .filter((quote) => !QUOTE_SKIP_STATUSES.has(quote.status))
    .slice(0, QUOTE_CHOICE_MAX_QUOTES)
    .map((quote) => {
      const vendor = firstOrSelf(quote.vendors)
      const vendorName = vendor?.business_name ?? "Vendor"
      return {
        id: quote.id,
        vendorName,
        line: formatQuoteChoiceLine({
          vendorName,
          pricePerDay: Number(quote.current_quote),
          rating: vendor?.reliability_score ?? null,
        }),
        pricePerDay: Number(quote.current_quote),
        rating: vendor?.reliability_score ?? null,
        vehicleLabel: firstOrSelf(quote.vehicle_types)?.label ?? vehicleLabel,
      }
    })

  const { data: intentData, error: intentError } = await supabase
    .from("whatsapp_payment_intents")
    .select("id, status, purpose, quote_snapshot_id, booking_id, created_at")
    .eq("trip_request_id", trip.id)
    .in("status", [...OPEN_INTENT_STATUSES])
    .order("created_at", { ascending: true })

  if (intentError && !isMissingRelation(intentError)) {
    throw new Error(`Failed to fetch payment intents: ${intentError.message}`)
  }

  const intents = (intentError ? [] : intentData ?? []) as unknown as IntentRow[]
  const tokenIntent = intents.find((intent) => intent.purpose === "token_lock") ?? null

  const { data: bookingData, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, payment_status, driver_id, final_quote, trip_days, pax_count, winning_quote_snapshot_id, drivers(full_name, phone_e164), vehicles(model, registration_number), vendors(business_name, reliability_score)",
    )
    .eq("trip_request_id", trip.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)

  const booking = (bookingData as unknown as BookingRow | null) ?? null
  const balanceIntent = booking
    ? intents.find((intent) => intent.purpose === "balance" && intent.booking_id === booking.id) ?? null
    : null

  const step = deriveGuestStep({
    ...stepInput,
    quoteCount: quotes.length,
    tokenIntentStatus: asIntentStatus(tokenIntent?.status),
    driverAssigned: Boolean(booking?.driver_id),
    balanceIntentStatus: asIntentStatus(balanceIntent?.status),
    balanceConfirmed: booking?.payment_status === "fully_paid",
  })

  const displayStep: GuestStep =
    previewStep === "driver_contact" && step !== "closed"
      ? "driver_contact"
      : previewStep === "token_received" && step !== "closed" && step !== "balance" && step !== "driver_contact"
        ? "token_received"
        : step

  let driverDetail: DriverDetailRow | null = null
  let rideGroupInviteUrl: string | null = null
  if (booking) {
    const { data: detail, error: detailError } = await supabase
      .from("driver_detail_submissions")
      .select("parsed_driver_name, parsed_driver_phone, parsed_vehicle_number, parsed_vehicle_model")
      .eq("booking_id", booking.id)
      .in("parse_status", ["parsed_ok", "ops_corrected"])
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (detailError && !isMissingRelation(detailError)) {
      throw new Error(`Failed to fetch driver details: ${detailError.message}`)
    }
    driverDetail = (detail as DriverDetailRow | null) ?? null

    const { data: group, error: groupError } = await supabase
      .from("whatsapp_ride_groups")
      .select("invite_link, status")
      .eq("booking_id", booking.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (groupError && !isMissingRelation(groupError)) {
      throw new Error(`Failed to fetch ride group: ${groupError.message}`)
    }
    const invite = group?.invite_link
    rideGroupInviteUrl = typeof invite === "string" && invite.length > 0 ? invite : null
  }

  const lockedQuote = tokenIntent?.quote_snapshot_id
    ? quotes.find((quote) => quote.id === tokenIntent.quote_snapshot_id) ??
      (await loadOneQuote(supabase, tokenIntent.quote_snapshot_id, vehicleLabel))
    : quotes[0] ?? null

  const driver = firstOrSelf(booking?.drivers)
  const vehicle = firstOrSelf(booking?.vehicles)
  const bookingVendor = firstOrSelf(booking?.vendors)
  const driverName = driverDetail?.parsed_driver_name?.trim() || driver?.full_name || "Your driver"
  const driverPhone = driverDetail?.parsed_driver_phone?.trim() || driver?.phone_e164 || null
  const vehicleModel = driverDetail?.parsed_vehicle_model?.trim() || vehicle?.model || "Vehicle"
  const vehicleNumber = driverDetail?.parsed_vehicle_number?.trim() || vehicle?.registration_number || "TBD"
  const vendorName = lockedQuote?.vendorName ?? bookingVendor?.business_name ?? "your operator"
  const pricePerDay = lockedQuote?.pricePerDay ?? Number(booking?.final_quote ?? 0)
  const rating = lockedQuote?.rating ?? bookingVendor?.reliability_score ?? null

  const bodyText = bodyForStep({
    step: displayStep,
    tripSummary,
    trip,
    vehicleLabel,
    quotes,
    vendorName,
    pricePerDay,
    rating,
    driverName,
    driverPhone,
    vehicleModel,
    vehicleNumber,
  })

  const hidePay =
    displayStep !== step ||
    (confirming === "token" && step === "lock") ||
    (confirming === "balance" && step === "balance")

  const paymentCrqid = step === "balance" ? balanceIntent?.id ?? null : step === "lock" ? tokenIntent?.id ?? null : null

  return {
    tripRequestId: trip.id,
    step,
    tripSummary,
    quotes: quotes.map((quote) => ({ id: quote.id, vendorName: quote.vendorName, line: quote.line })),
    bodyText,
    hidePay,
    paymentCrqid,
    driverPhone: displayStep === "driver_contact" ? driverPhone : null,
    footerText: footerForStep(displayStep),
    rideGroupInviteUrl,
    resumedExisting: false,
  }
}

const loadOneQuote = async (
  supabase: SupabaseClient,
  quoteId: string,
  fallbackVehicleLabel: string,
): Promise<{
  id: string
  vendorName: string
  line: string
  pricePerDay: number
  rating: number | null
  vehicleLabel: string
} | null> => {
  const { data, error } = await supabase
    .from("quote_snapshots")
    .select("id, current_quote, vendors(business_name, reliability_score), vehicle_types(label)")
    .eq("id", quoteId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as unknown as QuoteRow
  const vendor = firstOrSelf(row.vendors)
  const vendorName = vendor?.business_name ?? "Vendor"
  return {
    id: row.id,
    vendorName,
    pricePerDay: Number(row.current_quote),
    rating: vendor?.reliability_score ?? null,
    vehicleLabel: firstOrSelf(row.vehicle_types)?.label ?? fallbackVehicleLabel,
    line: formatQuoteChoiceLine({
      vendorName,
      pricePerDay: Number(row.current_quote),
      rating: vendor?.reliability_score ?? null,
    }),
  }
}

const bodyForStep = (input: {
  step: GuestStep
  tripSummary: string
  trip: TripRow
  vehicleLabel: string
  quotes: Array<{ id: string; vendorName: string; pricePerDay: number; rating: number | null; vehicleLabel: string }>
  vendorName: string
  pricePerDay: number
  rating: number | null
  driverName: string
  driverPhone: string | null
  vehicleModel: string
  vehicleNumber: string
}): string => {
  if (input.step === "quotes_waiting") {
    return `Your Kashmir cab quotes are on the way.\n${input.tripSummary}`
  }

  if (input.step === "quotes") {
    if (input.quotes.length === 1) {
      const quote = input.quotes[0]
      return buildQuoteSingleMessage({
        vendorName: quote.vendorName,
        pricePerDay: quote.pricePerDay,
        vehicleLabel: quote.vehicleLabel,
        quoteSnapshotId: quote.id,
      }).bodyText
    }
    return buildQuoteChoiceMessage({
      trip: {
        tripDays: input.trip.trip_days,
        paxCount: input.trip.pax_count,
        vehicleLabel: input.vehicleLabel,
        pickupLocation: input.trip.pickup_location,
        dropLocation: input.trip.drop_location,
      },
      quotes: input.quotes.map((quote) => ({
        quoteSnapshotId: quote.id,
        vendorName: quote.vendorName,
        pricePerDay: quote.pricePerDay,
        rating: quote.rating,
      })),
    }).bodyText
  }

  if (input.step === "lock") {
    return buildTokenPaymentLinkCopy({
      trip: {
        tripDays: input.trip.trip_days,
        paxCount: input.trip.pax_count,
        vehicleLabel: input.vehicleLabel,
        pickupLocation: input.trip.pickup_location,
        dropLocation: input.trip.drop_location,
        tripStartDate: input.trip.trip_start_date,
      },
      vendor: {
        vendorName: input.vendorName,
        pricePerDay: input.pricePerDay,
        rating: input.rating,
      },
    }).bodyText
  }

  if (input.step === "token_received") {
    const template = getMessageTemplate("token_received_v1")
    if (!template) {
      return buildTokenReceivedAckMessage({
        tripDays: input.trip.trip_days,
        paxCount: input.trip.pax_count,
        vehicleLabel: input.vehicleLabel,
        pickupLocation: input.trip.pickup_location,
        dropLocation: input.trip.drop_location,
        vendorName: input.vendorName,
      }).bodyText
    }
    return buildTokenReceivedAckMessage({
      tripDays: input.trip.trip_days,
      paxCount: input.trip.pax_count,
      vehicleLabel: input.vehicleLabel,
      pickupLocation: input.trip.pickup_location,
      dropLocation: input.trip.drop_location,
      vendorName: input.vendorName,
    }).bodyText
  }

  if (input.step === "balance") {
    const balanceDue = calculateBalanceDue(input.pricePerDay, input.trip.trip_days)
    return buildBalancePaymentLinkCopy({
      tripDays: input.trip.trip_days,
      paxCount: input.trip.pax_count,
      vehicleLabel: input.vehicleLabel,
      pickupLocation: input.trip.pickup_location,
      dropLocation: input.trip.drop_location,
      vendorName: input.vendorName,
      pricePerDay: input.pricePerDay,
      rating: input.rating,
      driverName: input.driverName,
      vehicleModel: input.vehicleModel,
      vehicleNumber: input.vehicleNumber,
      balanceDue,
    }).bodyText
  }

  if (input.step === "driver_contact") {
    return buildDriverContactMessage({
      driverName: input.driverName,
      driverPhone: input.driverPhone ?? "",
      vehicleModel: input.vehicleModel,
      vehicleNumber: input.vehicleNumber,
      vendorName: input.vendorName,
    }).bodyText
  }

  return renderMessageTemplate("This trip is closed.", {})
}
