"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils/cn"
import type { AdminDebugTripRequest } from "@/features/admin-debug/types"

export const TRIP_STATUS_LABELS: Record<string, string> = {
  matching: "Matching",
  quotes_ready: "Awaiting OTP",
  otp_pending: "OTP done",
  quotes_sent: "Quotes sent",
  negotiating: "Negotiating",
  booked: "Booked",
  expired: "Expired",
  abandoned: "Abandoned",
}

const STATUS_FILTER_ORDER = [
  "booked",
  "quotes_sent",
  "negotiating",
  "otp_pending",
  "quotes_ready",
  "matching",
  "expired",
  "abandoned",
] as const

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

export function filterFlowEligibleTrips(trips: AdminDebugTripRequest[]): AdminDebugTripRequest[] {
  return trips.filter((trip) => Boolean(trip.tourist_phone))
}

function formatTripOptionLabel(request: AdminDebugTripRequest): string {
  const phone = request.tourist_phone!
  const vehicle = request.requested_vehicle_type_label ?? "Vehicle"
  return `${phone} · ${request.trip_days}d · ${vehicle} · REQ-${shortId(request.id)}`
}

interface FlowTripSelectProps {
  trips: AdminDebugTripRequest[]
  value: string | null
  onChange: (tripRequestId: string) => void
}

export function FlowTripSelect({ trips, value, onChange }: FlowTripSelectProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const eligibleTrips = useMemo(() => filterFlowEligibleTrips(trips), [trips])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: eligibleTrips.length }
    for (const trip of eligibleTrips) {
      counts[trip.status] = (counts[trip.status] ?? 0) + 1
    }
    return counts
  }, [eligibleTrips])

  const availableStatuses = useMemo(() => {
    return STATUS_FILTER_ORDER.filter((status) => (statusCounts[status] ?? 0) > 0)
  }, [statusCounts])

  const filteredTrips = useMemo(() => {
    if (statusFilter === "all") return eligibleTrips
    return eligibleTrips.filter((trip) => trip.status === statusFilter)
  }, [eligibleTrips, statusFilter])

  useEffect(() => {
    if (filteredTrips.length === 0) return
    if (!value || !filteredTrips.some((trip) => trip.id === value)) {
      onChange(filteredTrips[0].id)
    }
  }, [filteredTrips, onChange, value])

  if (eligibleTrips.length === 0) {
    return (
      <p className="rounded-sm bg-kmr-surface px-3 py-3 text-center font-archivo text-xs text-kmr-muted-2">
        No trips with verified phone yet — complete OTP on the customer app.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[8.5px] font-semibold tracking-[1px] text-kmr-muted-3">
          FILTER BY STATUS
        </span>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter trips by status">
          <StatusFilterPill
            label="All"
            count={statusCounts.all ?? 0}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          {availableStatuses.map((status) => (
            <StatusFilterPill
              key={status}
              label={TRIP_STATUS_LABELS[status] ?? status}
              count={statusCounts[status] ?? 0}
              active={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            />
          ))}
        </div>
      </div>

      {filteredTrips.length === 0 ? (
        <p className="rounded-sm bg-kmr-surface px-3 py-3 text-center font-archivo text-xs text-kmr-muted-2">
          No trips with this status.
        </p>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[8.5px] font-semibold tracking-[1px] text-kmr-muted-3">
            TRIP ({filteredTrips.length})
          </span>
          <select
            value={value ?? filteredTrips[0]?.id ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-sm border border-black/10 bg-white px-3 py-2.5 font-archivo text-sm font-medium text-kmr-ink"
            aria-label="Select trip for WhatsApp flow"
          >
            {filteredTrips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {formatTripOptionLabel(trip)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function StatusFilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 font-archivo text-[11px] font-bold transition-colors",
        active ? "bg-kmr-ink text-white" : "bg-kmr-surface text-kmr-muted-1 hover:bg-black/5",
      )}
    >
      {label}
      <span className="ml-1 font-mono text-[9px] opacity-80">({count})</span>
    </button>
  )
}

export function formatFlowTripSummary(request: AdminDebugTripRequest): string {
  const vehicle = request.requested_vehicle_type_label ?? "Vehicle"
  const status = TRIP_STATUS_LABELS[request.status] ?? request.status
  const best = request.best_quote
    ? ` · from ₹${request.best_quote.toLocaleString("en-IN")}/day`
    : ""
  return `${status} · ${request.trip_days} days · ${request.pax_count} pax · ${vehicle}${best}`
}
