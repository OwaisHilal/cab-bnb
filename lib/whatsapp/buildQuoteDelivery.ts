import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { QuoteDeliveryPayload } from "@/lib/whatsapp/types"
import { isDemoMode } from "@/lib/otp/demoMode"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import {
  buildQuoteChoiceMessage,
  buildQuoteSingleMessage,
} from "@/lib/whatsapp/templateCatalog"

interface QuoteSnapshotRow {
  id: string
  vendor_id: string
  current_quote: number
  is_best_price: boolean
  vendors:
    | { business_name: string; reliability_score: number | null }
    | { business_name: string; reliability_score: number | null }[]
    | null
  vehicle_types: { label: string } | { label: string }[] | null
}

interface TripRequestRow {
  id: string
  pickup_location: string | null
  drop_location: string | null
  trip_days: number
  pax_count: number
  tourists: { phone_e164: string } | { phone_e164: string }[] | null
  requested_vehicle_type: { label: string } | { label: string }[] | null
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

async function loadQuoteSnapshotRows(
  supabase: SupabaseClient,
  tripRequestId: string,
  includeAlreadySent: boolean,
): Promise<QuoteSnapshotRow[] | { error: string; status: number; alreadySent?: boolean }> {
  const select =
    "id, vendor_id, current_quote, is_best_price, vendors(business_name, reliability_score), vehicle_types(label)"

  const { data: pendingRows, error: pendingError } = await supabase
    .from("quote_snapshots")
    .select(select)
    .eq("trip_request_id", tripRequestId)
    .eq("status", "pending_send")
    .order("current_quote", { ascending: true })

  if (pendingError) {
    return { error: `Failed to fetch quote snapshots: ${pendingError.message}`, status: 500 }
  }

  if ((pendingRows ?? []).length > 0) {
    return pendingRows as unknown as QuoteSnapshotRow[]
  }

  if (!includeAlreadySent) {
    return {
      error: "No pending_send quote snapshots — quotes may already be sent",
      status: 400,
      alreadySent: true,
    }
  }

  const { data: sentRows, error: sentError } = await supabase
    .from("quote_snapshots")
    .select(select)
    .eq("trip_request_id", tripRequestId)
    .in("status", ["sent", "viewed", "negotiating"])
    .order("current_quote", { ascending: true })

  if (sentError) {
    return { error: `Failed to fetch sent quote snapshots: ${sentError.message}`, status: 500 }
  }

  if (!sentRows || sentRows.length === 0) {
    return { error: "No quote snapshots available for this trip yet", status: 400 }
  }

  return sentRows as unknown as QuoteSnapshotRow[]
}

export async function buildQuoteDeliveryPayload(
  supabase: SupabaseClient,
  tripRequestId: string,
  options?: { includeAlreadySent?: boolean; quoteSnapshotId?: string },
): Promise<QuoteDeliveryPayload | { error: string; status: number; alreadySent?: boolean }> {
  await ensureMessageTemplates(supabase)

  const { data: tripRequest, error: tripRequestError } = await supabase
    .from("trip_requests")
    .select(
      "id, pickup_location, drop_location, trip_days, pax_count, tourists(phone_e164), requested_vehicle_type:vehicle_types!requested_vehicle_type_id(label)",
    )
    .eq("id", tripRequestId)
    .maybeSingle()

  if (tripRequestError) {
    return { error: `Failed to fetch trip request: ${tripRequestError.message}`, status: 500 }
  }
  if (!tripRequest) {
    return { error: `trip_request ${tripRequestId} not found`, status: 404 }
  }

  const trip = tripRequest as unknown as TripRequestRow
  const touristPhone = firstOrSelf(trip.tourists)?.phone_e164

  if (!touristPhone) {
    return { error: "Trip request has no verified tourist phone yet — complete OTP first", status: 400 }
  }

  const snapshots = await loadQuoteSnapshotRows(
    supabase,
    tripRequestId,
    Boolean(options?.includeAlreadySent || isDemoMode()),
  )

  if ("error" in snapshots) {
    return snapshots
  }

  const rows = snapshots
  const selectedRows = options?.quoteSnapshotId
    ? rows.filter((row) => row.id === options.quoteSnapshotId)
    : rows

  if (selectedRows.length === 0) {
    return { error: "Selected quote not found for this trip", status: 404 }
  }

  const activeRows = options?.quoteSnapshotId ? selectedRows : rows
  const focusQuote = activeRows[0]
  const bestPrice = rows.find((row) => row.is_best_price) ?? rows[0]
  const vehicleLabel =
    firstOrSelf(trip.requested_vehicle_type)?.label ??
    firstOrSelf(focusQuote.vehicle_types)?.label ??
    "Cab"

  if (options?.quoteSnapshotId || activeRows.length === 1) {
    const vendorName = firstOrSelf(focusQuote.vendors)?.business_name ?? "Vendor"
    const quoteVehicleLabel = firstOrSelf(focusQuote.vehicle_types)?.label ?? vehicleLabel
    const message = buildQuoteSingleMessage({
      vendorName,
      pricePerDay: focusQuote.current_quote,
      vehicleLabel: quoteVehicleLabel,
      quoteSnapshotId: focusQuote.id,
    })

    return {
      tripRequestId,
      touristPhone,
      message,
      snapshotIds: rows.map((row) => row.id),
      bestQuoteSnapshotId: focusQuote.id,
    }
  }

  const quotes = activeRows.slice(0, 3).map((row) => {
    const vendor = firstOrSelf(row.vendors)
    return {
      quoteSnapshotId: row.id,
      vendorName: vendor?.business_name ?? "Vendor",
      pricePerDay: row.current_quote,
      rating: vendor?.reliability_score ?? null,
    }
  })

  const message = buildQuoteChoiceMessage({
    trip: {
      tripDays: trip.trip_days,
      paxCount: trip.pax_count,
      vehicleLabel,
      pickupLocation: trip.pickup_location,
      dropLocation: trip.drop_location,
    },
    quotes,
  })

  return {
    tripRequestId,
    touristPhone,
    message,
    snapshotIds: rows.map((row) => row.id),
    bestQuoteSnapshotId: bestPrice.id,
  }
}
