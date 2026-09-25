"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils/cn"
import type { VendorDriverOption } from "@/lib/vendor-assign/vendorDriverOptions"
import { formatDisplayName } from "@/features/vendor-assign/components/formatDisplayName"

export interface BookingTripSummaryData {
  guestName: string
  routeLabel: string
  dateLabel: string
  paxAndVehicleLabel: string
  totalLabel: string
  bookingRef?: string
}

const splitRouteLabel = (routeLabel: string): { from: string; to: string } => {
  const parts = routeLabel.split(" → ")
  if (parts.length >= 2) {
    return { from: parts[0]!, to: parts.slice(1).join(" → ") }
  }
  return { from: routeLabel, to: "" }
}

function TripStat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="min-w-0 rounded-md bg-kmr-surface/80 px-2.5 py-2 ring-1 ring-black/[0.04]">
      <p className="font-archivo text-[10px] font-bold uppercase tracking-[0.08em] text-kmr-muted-2">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-archivo leading-tight text-kmr-ink",
          emphasize ? "text-[15px] font-extrabold tracking-[-0.2px]" : "text-xs font-semibold",
        )}
      >
        {value}
      </p>
    </div>
  )
}

export function BookingTripSummary({ booking }: { booking: BookingTripSummaryData }) {
  const { from, to } = splitRouteLabel(booking.routeLabel)

  return (
    <section
      className="overflow-hidden rounded-md border border-black/10 bg-white shadow-[0_1px_0_rgba(0,0,0,0.04)]"
      aria-label="Trip summary"
    >
      <div className="h-1 bg-gradient-to-r from-kmr-blue via-kmr-blue/80 to-kmr-blue/40" aria-hidden />
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-kmr-blue/10 px-2.5 py-0.5 font-archivo text-[10px] font-bold uppercase tracking-[0.06em] text-kmr-blue">
            Trip confirmed
          </span>
          {booking.bookingRef && (
            <span className="font-archivo text-[11px] font-semibold text-kmr-muted-2">{booking.bookingRef}</span>
          )}
        </div>

        <p className="mt-3 font-archivo text-xs font-semibold text-kmr-muted-1">Guest · {booking.guestName}</p>

        <div className="mt-1.5 font-archivo text-[17px] font-extrabold leading-[1.2] tracking-[-0.35px] text-kmr-ink">
          <span className="block truncate">{from}</span>
          {to ? (
            <span className="mt-0.5 flex items-center gap-1.5 text-kmr-blue">
              <span className="text-sm font-bold" aria-hidden>↓</span>
              <span className="min-w-0 truncate">{to}</span>
            </span>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <TripStat label="When" value={booking.dateLabel} />
          <TripStat label="Total" value={booking.totalLabel} emphasize />
        </div>
        <p className="mt-2 font-archivo text-xs font-semibold text-kmr-muted-1">{booking.paxAndVehicleLabel}</p>
      </div>
    </section>
  )
}

export function AssignFlowTabs({
  flow,
  onFlowChange,
}: {
  flow: "existing" | "manual"
  onFlowChange: (flow: "existing" | "manual") => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Choose how to assign a driver"
      className="flex gap-1 rounded-full bg-kmr-surface p-1 ring-1 ring-black/[0.06]"
    >
      <button
        type="button"
        role="tab"
        id="assign-driver-tab-existing"
        aria-selected={flow === "existing"}
        aria-controls="assign-driver-panel-existing"
        onClick={() => onFlowChange("existing")}
        tabIndex={0}
        className={cn(
          "flex-1 rounded-full px-3 py-2.5 font-archivo text-sm font-bold transition-all",
          flow === "existing"
            ? "bg-white text-kmr-blue shadow-[0_2px_8px_rgba(22,49,219,0.12)] ring-1 ring-kmr-blue/15"
            : "text-kmr-muted-1 hover:text-kmr-ink",
        )}
      >
        Saved driver
      </button>
      <button
        type="button"
        role="tab"
        id="assign-driver-tab-manual"
        aria-selected={flow === "manual"}
        aria-controls="assign-driver-panel-manual"
        onClick={() => onFlowChange("manual")}
        tabIndex={0}
        className={cn(
          "flex-1 rounded-full px-3 py-2.5 font-archivo text-sm font-bold transition-all",
          flow === "manual"
            ? "bg-white text-kmr-blue shadow-[0_2px_8px_rgba(22,49,219,0.12)] ring-1 ring-kmr-blue/15"
            : "text-kmr-muted-1 hover:text-kmr-ink",
        )}
      >
        New driver
      </button>
    </div>
  )
}

export function DriverSearchField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label htmlFor="assign-driver-search" className="flex flex-col gap-1.5 text-left">
      <span className="font-archivo text-xs font-bold uppercase tracking-[0.06em] text-kmr-muted-2">Search saved drivers</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-archivo text-sm text-kmr-muted-2" aria-hidden>
          ⌕
        </span>
        <input
          id="assign-driver-search"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Name, phone, or plate"
          aria-label="Search saved drivers"
          tabIndex={0}
          className="w-full rounded-md border border-black/10 bg-white py-3 pl-9 pr-3 font-archivo text-[15px] text-kmr-ink shadow-[inset_0_1px_2px_rgba(16,17,24,0.04)] outline-none focus-visible:border-kmr-blue focus-visible:ring-2 focus-visible:ring-kmr-blue/20"
        />
      </div>
    </label>
  )
}

export function formatDriverVehicleLine(option: VendorDriverOption): string {
  if (option.registrationNumber && option.model) {
    return `${option.model} · ${option.registrationNumber}`
  }
  return "No vehicle on file"
}

export function DriverOptionRow({
  option,
  selected,
  onSelect,
}: {
  option: VendorDriverOption
  selected: boolean
  onSelect: () => void
}) {
  const displayName = formatDisplayName(option.fullName)
  const vehicleLabel = formatDriverVehicleLine(option)
  return (
    <button
      type="button"
      role="option"
      aria-pressed={selected}
      aria-selected={selected}
      aria-label={`Select ${displayName}, ${vehicleLabel}`}
      onClick={onSelect}
      tabIndex={0}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-3 text-left transition-all",
        selected
          ? "border-kmr-blue bg-kmr-blue/[0.07] shadow-[0_0_0_1px_rgba(22,49,219,0.12)] ring-2 ring-kmr-blue/20"
          : "border-black/[0.06] bg-white hover:border-kmr-blue/25 hover:shadow-sm",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-kmr-blue bg-kmr-blue text-white" : "border-kmr-muted-3 bg-white",
          )}
          aria-hidden
        >
          {selected && <span className="text-[10px] leading-none">✓</span>}
        </span>
        <span className="min-w-0 flex flex-col gap-0.5">
          <span
            className={cn(
              "truncate font-archivo text-[15px]",
              selected ? "font-extrabold text-kmr-blue" : "font-bold text-kmr-ink",
            )}
          >
            {displayName}
          </span>
          <span className="truncate font-archivo text-xs text-kmr-muted-1">
            •••• {option.phoneLast10.slice(-4)} · {vehicleLabel}
          </span>
        </span>
      </span>
    </button>
  )
}

export function PhotoChip({ label, available }: { label: string; available: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-archivo text-[10px] font-semibold",
        available ? "bg-kmr-green/10 text-kmr-green" : "bg-kmr-muted-2/10 text-kmr-muted-2",
      )}
    >
      {available ? "✓" : "–"} {label}
    </span>
  )
}

export function AssignDriverField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
  required = false,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  inputMode?: "text" | "tel" | "numeric"
  autoComplete?: string
  required?: boolean
  hint?: string
}) {
  const id = `assign-driver-${label.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-left">
      <span className="font-archivo text-xs font-bold text-kmr-ink">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        aria-label={label}
        tabIndex={0}
        className="rounded-md border border-black/10 bg-white px-3 py-3 font-archivo text-[15px] text-kmr-ink shadow-[inset_0_1px_2px_rgba(16,17,24,0.04)] outline-none focus-visible:border-kmr-blue focus-visible:ring-2 focus-visible:ring-kmr-blue/20"
      />
      {hint && <span className="font-archivo text-[11px] text-kmr-muted-2">{hint}</span>}
    </label>
  )
}

export function SelectedDriverCard({
  option,
  addVehicleForSelected,
  selectedVehicleNumber,
  selectedVehicleModel,
  onChangeVehicle,
  onToggleDifferentVehicle,
  onChangeDriver,
}: {
  option: VendorDriverOption
  addVehicleForSelected: boolean
  selectedVehicleNumber: string
  selectedVehicleModel: string
  onChangeVehicle: (field: "number" | "model", value: string) => void
  onToggleDifferentVehicle: () => void
  onChangeDriver: () => void
}) {
  const displayName = formatDisplayName(option.fullName)
  const vehicleLine = formatDriverVehicleLine(option)

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-kmr-blue/15 bg-gradient-to-b from-kmr-blue/[0.05] to-white p-4 ring-1 ring-kmr-blue/10"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-archivo text-[15px] font-bold text-kmr-ink">{displayName}</p>
          <p className="mt-0.5 font-archivo text-xs text-kmr-muted-1">
            •••• {option.phoneLast10.slice(-4)} · {vehicleLine}
          </p>
        </div>
        <button
          type="button"
          onClick={onChangeDriver}
          tabIndex={0}
          className="shrink-0 font-archivo text-xs font-semibold text-kmr-blue hover:underline"
        >
          Change driver
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <PhotoChip label="Driver photo" available={option.hasDriverPhoto} />
        <PhotoChip label="Car photo" available={option.hasVehiclePhoto} />
      </div>

      {option.primaryVehicleId && (
        <button
          type="button"
          onClick={onToggleDifferentVehicle}
          tabIndex={0}
          className="self-start font-archivo text-xs font-semibold text-kmr-blue hover:underline"
        >
          {addVehicleForSelected ? "Use saved vehicle instead" : "Use a different vehicle for this trip"}
        </button>
      )}

      {addVehicleForSelected && (
        <div className="flex flex-col gap-3 rounded-sm bg-white p-3">
          <p className="font-archivo text-xs font-semibold text-kmr-muted-1">
            {option.primaryVehicleId ? "Vehicle for this trip" : "Add this driver's vehicle — none on file yet"}
          </p>
          <AssignDriverField
            label="Vehicle number"
            value={selectedVehicleNumber}
            onChange={(value) => onChangeVehicle("number", value.toUpperCase())}
            placeholder="e.g. JK01AB1234"
            required
          />
          <AssignDriverField
            label="Vehicle model"
            value={selectedVehicleModel}
            onChange={(value) => onChangeVehicle("model", value)}
            placeholder="e.g. Swift Dzire"
            required
          />
        </div>
      )}
    </div>
  )
}

export function AssignFormSection({
  title,
  description,
  accent = "blue",
  children,
}: {
  title: string
  description?: string
  accent?: "blue" | "orange"
  children: ReactNode
}) {
  const accentBar = accent === "orange" ? "bg-kmr-orange" : "bg-kmr-blue"
  return (
    <section className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <div className="flex gap-3">
        <span className={cn("mt-0.5 w-1 shrink-0 self-stretch rounded-full", accentBar)} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-archivo text-[15px] font-extrabold tracking-[-0.2px] text-kmr-ink">{title}</h2>
          {description && <p className="mt-0.5 font-archivo text-xs font-medium text-kmr-muted-1">{description}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

export function AssignDriverStickyFooter({ children }: { children: ReactNode }) {
  return (
    <div
      className="sticky bottom-0 -mx-6 border-t border-black/[0.06] bg-white/95 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-12px_32px_rgba(16,17,24,0.08)] backdrop-blur-md"
    >
      {children}
    </div>
  )
}

export function AssignDriverCtaLabel({
  selectedName,
}: {
  selectedName: string | null
}) {
  if (!selectedName) return "Select a driver above"
  const display = formatDisplayName(selectedName)
  return (
    <span className="block truncate">
      Assign {display}
    </span>
  )
}
