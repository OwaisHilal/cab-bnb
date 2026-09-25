import type { ReactNode } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server"
import { formatInr } from "@/lib/whatsapp/formatInr"
import { verifyVendorAssignToken } from "@/lib/whatsapp/vendorAssignToken"
import { isBookingAssignable, type ResolvedVendorBooking } from "@/lib/whatsapp/assignDriverToBooking"
import {
  loadVendorDriverOptions,
  sortVendorDriverOptionsByPreferredVehicleType,
} from "@/lib/vendor-assign/vendorDriverOptions"
import { AssignDriverForm, type BookingSummaryForForm } from "@/features/vendor-assign/components/AssignDriverForm"

export const metadata = {
  title: "Assign driver — KMR Cabs",
}

// Token validity + booking status are both time-sensitive — always read fresh.
export const dynamic = "force-dynamic"

interface VendorBookingSummary extends ResolvedVendorBooking {
  bookingRef: string | null
  guestName: string
  pickupLocation: string
  dropLocation: string
  pickupAt: string
  tripDays: number
  paxCount: number
  vehicleLabel: string
  tripTotal: number
}

const firstOrSelf = <T,>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

const formatPickupDate = (pickupAt: string): string => {
  return new Date(pickupAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

async function loadBookingSummary(supabase: SupabaseClient, bookingId: string): Promise<VendorBookingSummary | null> {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, status, vendor_id, lock_type, payment_status, vehicle_type_id, final_quote, pickup_at, trip_days, pax_count, trip_requests(pickup_location, drop_location), tourists(full_name), vehicle_types(label)",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (error) {
    console.error("[vendor/assign-driver] failed to load booking", { bookingId, error: error.message })
    return null
  }
  if (!booking) return null

  const trip = firstOrSelf(
    booking.trip_requests as
      | { pickup_location: string | null; drop_location: string | null }
      | { pickup_location: string | null; drop_location: string | null }[]
      | null,
  )
  const guestName =
    firstOrSelf(booking.tourists as { full_name: string | null } | { full_name: string | null }[] | null)?.full_name?.trim() ||
    "Guest"
  const tripDays = booking.trip_days as number

  return {
    bookingId: booking.id as string,
    bookingRef: (booking.booking_ref as string | null) ?? null,
    vendorId: booking.vendor_id as string,
    status: booking.status as string,
    lockType: booking.lock_type as string | null,
    paymentStatus: booking.payment_status as string,
    vehicleTypeId: booking.vehicle_type_id as number | null,
    guestName,
    pickupLocation: trip?.pickup_location ?? "Pickup",
    dropLocation: trip?.drop_location ?? "Drop",
    pickupAt: booking.pickup_at as string,
    tripDays,
    paxCount: booking.pax_count as number,
    vehicleLabel: firstOrSelf(booking.vehicle_types as { label: string } | { label: string }[] | null)?.label ?? "Vehicle",
    tripTotal: Number(booking.final_quote ?? 0) * tripDays,
  }
}

function PageShell({ children, showHeader = true }: { children: ReactNode; showHeader?: boolean }) {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center bg-[linear-gradient(180deg,#e7e7ea_0%,#f5f5f7_45%,#e7e7ea_100%)] px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_16px_48px_rgba(16,17,24,0.1)] ring-1 ring-black/[0.06]">
        {showHeader && (
          <header className="border-b border-black/[0.06] bg-gradient-to-b from-kmr-blue/[0.08] to-transparent px-6 pb-4 pt-6">
            <p className="font-archivo text-[10px] font-bold uppercase tracking-[0.14em] text-kmr-blue">KMR Cabs</p>
            <h1 className="mt-1 font-archivo text-[22px] font-extrabold tracking-[-0.45px] text-kmr-ink">Assign a driver</h1>
            <p className="mt-1.5 font-archivo text-[13px] font-medium leading-snug text-kmr-muted-1">
              Pick from your roster or add someone new — the guest is notified on WhatsApp.
            </p>
          </header>
        )}
        <div className="px-6 py-5">{children}</div>
      </div>
    </main>
  )
}

function ErrorMessage({ title, body }: { title: string; body: string }) {
  return (
    <PageShell>
      <h1 className="text-center font-archivo text-lg font-bold text-kmr-ink">{title}</h1>
      <p className="mt-2 text-center font-archivo text-sm text-kmr-muted-1">{body}</p>
    </PageShell>
  )
}

export default async function AssignDriverPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (!token) {
    return (
      <ErrorMessage
        title="Missing link"
        body="This page needs a token — please open the link from the booking notification on WhatsApp."
      />
    )
  }

  let verified
  try {
    verified = verifyVendorAssignToken(token)
  } catch (error) {
    console.error("[vendor/assign-driver] token verification failed", error)
    return <ErrorMessage title="This page isn't available right now" body="Please try again in a moment." />
  }

  if (!verified.ok) {
    const body =
      verified.reason === "expired"
        ? "This link has expired. Ask for a fresh one from the booking notification on WhatsApp."
        : "This link is invalid. Please open the latest link from the booking notification on WhatsApp."
    return <ErrorMessage title="Link no longer valid" body={body} />
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabaseServiceRoleClient()
  } catch (error) {
    console.error("[vendor/assign-driver] supabase client failed", error)
    return <ErrorMessage title="This page isn't available right now" body="Please try again in a moment." />
  }

  // Booking summary and the vendor's saved-driver roster are independent
  // reads — load them together so the roster query isn't an extra
  // sequential round-trip before this (WhatsApp in-app browser) page can
  // render.
  const [booking, driverOptions] = await Promise.all([
    loadBookingSummary(supabase, verified.payload.bookingId),
    loadVendorDriverOptions(supabase, verified.payload.vendorId),
  ])

  if (!booking || booking.vendorId !== verified.payload.vendorId) {
    return (
      <ErrorMessage title="Link no longer valid" body="This booking couldn't be found for this link." />
    )
  }

  if (!isBookingAssignable(booking)) {
    return (
      <ErrorMessage
        title="Driver already assigned"
        body="A driver has already been assigned to this booking — no further action needed."
      />
    )
  }

  const dayLabel = booking.tripDays > 1 ? "days" : "day"
  const sortedDriverOptions = sortVendorDriverOptionsByPreferredVehicleType(driverOptions, booking.vehicleTypeId)

  const bookingSummary: BookingSummaryForForm = {
    guestName: booking.guestName,
    routeLabel: `${booking.pickupLocation} → ${booking.dropLocation}`,
    dateLabel: `${formatPickupDate(booking.pickupAt)}, ${booking.tripDays} ${dayLabel}`,
    paxAndVehicleLabel: `Pax: ${booking.paxCount} · Cab: ${booking.vehicleLabel}`,
    totalLabel: formatInr(booking.tripTotal),
    bookingRef: booking.bookingRef ?? undefined,
  }

  return (
    <PageShell>
      <AssignDriverForm token={token} booking={bookingSummary} driverOptions={sortedDriverOptions} />
    </PageShell>
  )
}
