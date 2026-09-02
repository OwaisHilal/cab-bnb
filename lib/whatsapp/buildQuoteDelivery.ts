import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { QuoteDeliveryPayload } from "@/lib/whatsapp/types"
import { isDemoMode } from "@/lib/otp/demoMode"
import { ensureMessageTemplates } from "@/lib/whatsapp/messageTemplateStore"
import {
  buildQuoteMultiMessage,
  buildQuoteSingleMessage,
} from "@/lib/whatsapp/templateCatalog"

interface QuoteSnapshotRow {
  id: string
  vendor_id: string
  current_quote: number
  is_best_price: boolean
  vendors: { business_name: string } | { business_name: string }[] | null
  vehicle_types: { label: string } | { label: string }[] | null
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

async function loadQuoteSnapshotRows(
  supabase: SupabaseClient,
  tripRequestId: string,
  includeAlreadySent: boolean,
): Promise<QuoteSnapshotRow[] | { error: string; status: number }> {
  const select =
    "id, vendor_id, current_quote, is_best_price, vendors(business_name), vehicle_types(label)"

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
    return { error: "No pending_send quote snapshots — quotes may already be sent", status: 400 }
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
): Promise<QuoteDeliveryPayload | { error: string; status: number }> {
  await ensureMessageTemplates(supabase)

  const { data: tripRequest, error: tripRequestError } = await supabase
    .from("trip_requests")
    .select("id, tourists(phone_e164)")
    .eq("id", tripRequestId)
    .maybeSingle()

  if (tripRequestError) {
    return { error: `Failed to fetch trip request: ${tripRequestError.message}`, status: 500 }
  }
  if (!tripRequest) {
    return { error: `trip_request ${tripRequestId} not found`, status: 404 }
  }

  const touristPhone = firstOrSelf(
    (tripRequest as unknown as { tourists: { phone_e164: string } | { phone_e164: string }[] | null }).tourists,
  )?.phone_e164

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

  if (options?.quoteSnapshotId) {
    const vendorName = firstOrSelf(focusQuote.vendors)?.business_name ?? "Vendor"
    const vehicleLabel = firstOrSelf(focusQuote.vehicle_types)?.label ?? "Vehicle"
    const message = buildQuoteSingleMessage({
      vendorName,
      pricePerDay: focusQuote.current_quote,
      vehicleLabel,
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

  const quoteLines = activeRows.map((row) => {
    const vendorName = firstOrSelf(row.vendors)?.business_name ?? "Vendor"
    const vehicleLabel = firstOrSelf(row.vehicle_types)?.label ?? "Vehicle"
    return `${vendorName}: \u20b9${row.current_quote}/day (${vehicleLabel})`
  })

  const quoteRows = activeRows.map((row) => ({
    quoteSnapshotId: row.id,
    vendorName: firstOrSelf(row.vendors)?.business_name ?? "Vendor",
    pricePerDay: row.current_quote,
    vehicleLabel: firstOrSelf(row.vehicle_types)?.label ?? "Vehicle",
  }))

  const message = buildQuoteMultiMessage({
    quoteLines,
    bestQuoteSnapshotId: bestPrice.id,
    quoteRows,
  })

  return {
    tripRequestId,
    touristPhone,
    message,
    snapshotIds: rows.map((row) => row.id),
    bestQuoteSnapshotId: bestPrice.id,
  }
}
