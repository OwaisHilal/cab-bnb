import { NextRequest } from "next/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"
import { jsonError, jsonOk } from "@/lib/api/errors"
import { composeAndUploadDriverCard } from "@/lib/drivers/composeDriverCard"

export const runtime = "nodejs"

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return jsonError(500, "Missing CRON_SECRET")
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return jsonError(401, "Unauthorized")
  }

  let body: { booking_id?: string }
  try {
    body = (await request.json()) as { booking_id?: string }
  } catch {
    return jsonError(400, "Invalid JSON")
  }

  const bookingId = body.booking_id?.trim()
  if (!bookingId) return jsonError(400, "booking_id is required")

  let supabase
  try {
    supabase = getSupabaseServiceRoleClient()
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured")
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, drivers(full_name, photo_url), vehicles(stock_photo_url, vehicle_types(code))",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (error) return jsonError(500, error.message)
  if (!booking) return jsonError(404, "booking not found")

  const driver = firstOrSelf(
    booking.drivers as { full_name: string; photo_url: string | null } | { full_name: string; photo_url: string | null }[] | null,
  )
  const vehicle = firstOrSelf(
    booking.vehicles as
      | { stock_photo_url: string | null; vehicle_types: { code: string } | { code: string }[] | null }
      | { stock_photo_url: string | null; vehicle_types: { code: string } | { code: string }[] | null }[]
      | null,
  )
  const vehicleType = firstOrSelf(vehicle?.vehicle_types ?? null)

  const url = await composeAndUploadDriverCard(supabase, {
    driverName: driver?.full_name ?? "Driver",
    photoUrl: driver?.photo_url,
    stockPhotoUrl: vehicle?.stock_photo_url,
    vehicleCode: vehicleType?.code ?? null,
  })

  if (!url) return jsonOk({ url: null })
  return jsonOk({ url })
}
