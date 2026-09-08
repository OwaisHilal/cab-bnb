import type { SupabaseClient } from "@supabase/supabase-js"
import { phoneLast10 } from "@/lib/drivers/phone"
import { quoteChoiceSelectTitle } from "@/lib/whatsapp/quoteChoiceTemplate"
import type { InboundWhatsAppMessage, ParsedAction } from "./types"

const SELECT_VENDOR_TITLE_RE = /^Select .+$/
const QUOTE_STATUSES_FOR_TAP = ["sent", "viewed"] as const

export interface SelectVendorSnapshotRow {
  id: string
  vendorName: string
}

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export function parseSelectVendorTapText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? ""
  if (!SELECT_VENDOR_TITLE_RE.test(trimmed)) return null
  return trimmed
}

export function matchUniqueSelectVendorSnapshot(
  inboundTitle: string,
  snapshots: SelectVendorSnapshotRow[],
): string | null {
  const wanted = inboundTitle.trim().toLowerCase()
  if (!wanted) return null
  const matches = snapshots.filter(
    (row) => quoteChoiceSelectTitle(row.vendorName).toLowerCase() === wanted,
  )
  if (matches.length !== 1) return null
  return matches[0]?.id ?? null
}

function touristPhoneLookupValues(last10: string): string[] {
  return [`+91${last10}`, `91${last10}`, last10]
}

/**
 * When Utility QR inbound has no BOOK_TOKEN payload, uniquely map
 * `Select {vendor}` to a sent/viewed snapshot on the tourist's latest trip.
 */
export async function resolveSelectVendorTap(
  supabase: SupabaseClient,
  message: InboundWhatsAppMessage,
): Promise<ParsedAction | null> {
  const inboundTitle = parseSelectVendorTapText(message.textBody)
  if (!inboundTitle) return null

  const last10 = phoneLast10(message.fromPhone)
  if (last10.length !== 10) return null

  const { data: tourists, error: touristError } = await supabase
    .from("tourists")
    .select("id, phone_e164")
    .in("phone_e164", touristPhoneLookupValues(last10))
    .limit(5)

  if (touristError) {
    throw new Error(`Failed to look up tourist for Select tap: ${touristError.message}`)
  }

  const touristMatches = (tourists ?? []).filter(
    (row: { phone_e164: string }) => phoneLast10(row.phone_e164) === last10,
  )
  if (touristMatches.length !== 1) {
    console.info("[whatsapp webhook] select-title unmatched tourist", {
      last10Count: touristMatches.length,
    })
    return null
  }

  const touristId = touristMatches[0]?.id as string
  const { data: trips, error: tripError } = await supabase
    .from("trip_requests")
    .select("id, created_at, quote_snapshots(id, status, vendors(business_name))")
    .eq("tourist_id", touristId)
    .order("created_at", { ascending: false })
    .limit(8)

  if (tripError) {
    throw new Error(`Failed to look up quotes for Select tap: ${tripError.message}`)
  }

  for (const trip of trips ?? []) {
    const snapshots = (
      (trip.quote_snapshots ?? []) as Array<{
        id: string
        status: string
        vendors: { business_name: string } | { business_name: string }[] | null
      }>
    )
      .filter((row) => QUOTE_STATUSES_FOR_TAP.includes(row.status as (typeof QUOTE_STATUSES_FOR_TAP)[number]))
      .map((row) => ({
        id: row.id,
        vendorName: firstOrSelf(row.vendors)?.business_name ?? "",
      }))
      .filter((row) => row.vendorName.length > 0)

    if (snapshots.length === 0) continue

    const quoteSnapshotId = matchUniqueSelectVendorSnapshot(inboundTitle, snapshots)
    if (!quoteSnapshotId) {
      console.info("[whatsapp webhook] select-title no unique vendor", {
        title: inboundTitle,
        tripRequestId: trip.id,
        snapshotCount: snapshots.length,
      })
      return null
    }

    return { type: "book_token", quoteSnapshotId }
  }

  console.info("[whatsapp webhook] select-title no sent quotes", { inboundTitle })
  return null
}
