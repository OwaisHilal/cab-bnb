"use client"

import { useMemo, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/utils/cn"
import { normalizeVehicleRegistration } from "@/lib/drivers/vehicle"
// Type-only: vendorDriverOptions.ts has `import "server-only"` at the top,
// so only the shape may cross into this client component.
import type { VendorDriverOption } from "@/lib/vendor-assign/vendorDriverOptions"

export interface BookingSummaryForForm {
  guestName: string
  routeLabel: string
  dateLabel: string
  paxAndVehicleLabel: string
  totalLabel: string
}

interface AssignDriverFormProps {
  token: string
  booking: BookingSummaryForForm
  driverOptions: VendorDriverOption[]
}

type Flow = "existing" | "manual"

interface ExistingDriverConflict {
  driverId: string
  fullName: string
  phoneE164: string
}

interface ApiErrorState {
  code?: string
  message: string
  existingDriver?: ExistingDriverConflict
}

type HardStop = "expired" | "invalid" | "already_assigned"

interface SuccessInfo {
  fullName: string
  vehicleLabel: string
}

type ManualFieldKey = "driverName" | "driverPhone" | "vehicleNumber" | "vehicleModel"
type ManualFieldState = Record<ManualFieldKey, string>

const EMPTY_MANUAL_FIELDS: ManualFieldState = {
  driverName: "",
  driverPhone: "",
  vehicleNumber: "",
  vehicleModel: "",
}

type AssignDriverPayload =
  | { token: string; mode: "existing"; driver_id: string }
  | {
      token: string
      mode: "manual"
      driver_name: string
      driver_phone: string
      vehicle_number: string
      vehicle_model: string
    }

/**
 * Submitted from app/vendor/assign-driver (linked from the vendor's
 * WhatsApp "Assign driver" CTA). Posts to app/api/vendor/assign-driver,
 * which shares the same upsert/attach logic as the legacy free-text
 * `DRIVER: ...` WhatsApp reply (lib/whatsapp/assignDriverToBooking.ts) —
 * either path produces an identical booking outcome.
 *
 * Two flows:
 * - "existing" — pick a saved driver from the vendor's roster (fast path,
 *   autofills vehicle from that driver's primary link).
 * - "manual" — type a new driver's details by hand.
 *
 * If a saved driver has no vehicle on file yet, or the vendor wants to
 * assign a different vehicle for this trip, the vehicle mini-form still
 * submits through the API's "manual" mode using that driver's exact saved
 * name/phone — this reuses the same server-side upsert logic (and its
 * name-conflict guard) without ever risking a duplicate driver row.
 */
export function AssignDriverForm({ token, booking, driverOptions }: AssignDriverFormProps) {
  const [flow, setFlow] = useState<Flow>(driverOptions.length > 0 ? "existing" : "manual")
  const [summaryOpen, setSummaryOpen] = useState(true)

  // "Choose existing driver" flow state
  const [query, setQuery] = useState("")
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  const [syntheticSelectedDriver, setSyntheticSelectedDriver] = useState<VendorDriverOption | null>(null)
  const [addVehicleForSelected, setAddVehicleForSelected] = useState(false)
  const [selectedVehicleNumber, setSelectedVehicleNumber] = useState("")
  const [selectedVehicleModel, setSelectedVehicleModel] = useState("")

  // "Add new driver manually" flow state
  const [manualFields, setManualFields] = useState<ManualFieldState>(EMPTY_MANUAL_FIELDS)

  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<ApiErrorState | null>(null)
  const [hardStop, setHardStop] = useState<HardStop | null>(null)
  const [success, setSuccess] = useState<SuccessInfo | null>(null)

  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return driverOptions
    return driverOptions.filter((option) => option.searchText.includes(trimmed))
  }, [query, driverOptions])

  const selectedOption = useMemo(
    () => driverOptions.find((option) => option.driverId === selectedDriverId) ?? syntheticSelectedDriver,
    [driverOptions, selectedDriverId, syntheticSelectedDriver],
  )

  const updateManualField = (key: ManualFieldKey) => (value: string) => {
    setManualFields((current) => ({ ...current, [key]: value }))
  }

  const handleSetFlow = (next: Flow) => {
    setFlow(next)
    setApiError(null)
  }

  const handleSelectDriver = (option: VendorDriverOption) => {
    setSelectedDriverId(option.driverId)
    setSyntheticSelectedDriver(null)
    setApiError(null)
    setSummaryOpen(false)
    const needsVehicle = !option.primaryVehicleId
    setAddVehicleForSelected(needsVehicle)
    setSelectedVehicleNumber(needsVehicle ? "" : option.registrationNumber ?? "")
    setSelectedVehicleModel(needsVehicle ? "" : option.model ?? "")
  }

  const handleToggleDifferentVehicle = () => {
    setAddVehicleForSelected((prev) => {
      const next = !prev
      setSelectedVehicleNumber(next ? "" : selectedOption?.registrationNumber ?? "")
      setSelectedVehicleModel(next ? "" : selectedOption?.model ?? "")
      return next
    })
  }

  const handleUseExistingFromConflict = () => {
    const existing = apiError?.existingDriver
    if (!existing) return
    setApiError(null)
    setFlow("existing")
    // The conflicting driver may not be in the visible active roster (e.g.
    // inactive, or the roster cap) — represent it as a synthetic option so
    // the review card + submit still work. The server re-validates
    // everything by ID/phone regardless of what we send from here.
    setSyntheticSelectedDriver({
      driverId: existing.driverId,
      fullName: existing.fullName,
      phoneLast10: existing.phoneE164.replace(/\D/g, "").slice(-10),
      hasDriverPhoto: false,
      primaryVehicleId: null,
      registrationNumber: null,
      model: null,
      vehicleTypeId: null,
      hasVehiclePhoto: false,
      searchText: "",
    })
    setSelectedDriverId(existing.driverId)
    setAddVehicleForSelected(true)
    setSelectedVehicleNumber("")
    setSelectedVehicleModel("")
  }

  const submit = async (payload: AssignDriverPayload, successInfo: SuccessInfo) => {
    setSubmitting(true)
    setApiError(null)
    try {
      const response = await fetch("/api/vendor/assign-driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = (await response.json().catch(() => null)) as
        | { error?: string; code?: string; existingDriver?: ExistingDriverConflict }
        | null

      if (!response.ok) {
        if (data?.code === "expired_token") {
          setHardStop("expired")
          return
        }
        if (data?.code === "invalid_token") {
          setHardStop("invalid")
          return
        }
        if (data?.code === "already_assigned") {
          setHardStop("already_assigned")
          return
        }
        setApiError({
          code: data?.code,
          message: data?.error ?? "Something went wrong. Please try again.",
          existingDriver: data?.existingDriver,
        })
        return
      }

      setSuccess(successInfo)
    } catch {
      setApiError({ message: "Network error — please check your connection and try again." })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitExisting = async () => {
    if (!selectedOption) return
    setApiError(null)

    if (addVehicleForSelected) {
      const normalizedVehicleNumber = normalizeVehicleRegistration(selectedVehicleNumber)
      const trimmedModel = selectedVehicleModel.trim()
      if (!normalizedVehicleNumber || !trimmedModel) {
        setApiError({ message: "Please add the vehicle number and model for this driver." })
        return
      }
      await submit(
        {
          token,
          mode: "manual",
          driver_name: selectedOption.fullName,
          driver_phone: selectedOption.phoneLast10,
          vehicle_number: normalizedVehicleNumber,
          vehicle_model: trimmedModel,
        },
        { fullName: selectedOption.fullName, vehicleLabel: `${trimmedModel} (${normalizedVehicleNumber})` },
      )
      return
    }

    await submit(
      { token, mode: "existing", driver_id: selectedOption.driverId },
      {
        fullName: selectedOption.fullName,
        vehicleLabel:
          selectedOption.model && selectedOption.registrationNumber
            ? `${selectedOption.model} (${selectedOption.registrationNumber})`
            : "the vehicle on file",
      },
    )
  }

  const handleSubmitManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setApiError(null)

    const trimmedName = manualFields.driverName.trim()
    const phoneDigits = manualFields.driverPhone.replace(/\D/g, "")
    const normalizedVehicleNumber = normalizeVehicleRegistration(manualFields.vehicleNumber)
    const trimmedModel = manualFields.vehicleModel.trim()

    if (!trimmedName) {
      setApiError({ message: "Please enter the driver's name." })
      return
    }
    if (phoneDigits.length < 10 || phoneDigits.length > 13) {
      setApiError({ message: "Please enter a valid 10-digit mobile number." })
      return
    }
    if (!normalizedVehicleNumber) {
      setApiError({ message: "Please enter the vehicle number." })
      return
    }
    if (!trimmedModel) {
      setApiError({ message: "Please enter the vehicle model." })
      return
    }

    await submit(
      {
        token,
        mode: "manual",
        driver_name: trimmedName,
        driver_phone: phoneDigits,
        vehicle_number: normalizedVehicleNumber,
        vehicle_model: trimmedModel,
      },
      { fullName: trimmedName, vehicleLabel: `${trimmedModel} (${normalizedVehicleNumber})` },
    )
  }

  if (hardStop) {
    const copy =
      hardStop === "already_assigned"
        ? { title: "Driver already assigned", body: "A driver has already been assigned to this booking — no further action needed." }
        : hardStop === "expired"
          ? { title: "Link expired", body: "This link has expired. Please open the latest link from the booking notification on WhatsApp." }
          : { title: "Link no longer valid", body: "Please open the latest link from the booking notification on WhatsApp." }
    return (
      <div className="rounded-sm bg-kmr-surface p-4 text-center">
        <p className="font-archivo text-[15px] font-bold text-kmr-ink">{copy.title}</p>
        <p className="mt-1 font-archivo text-sm text-kmr-muted-1">{copy.body}</p>
      </div>
    )
  }

  if (success) {
    return (
      <div className="rounded-sm bg-kmr-surface p-4 text-center">
        <p className="font-archivo text-[15px] font-bold text-kmr-green">Driver assigned</p>
        <p className="mt-1 font-archivo text-sm text-kmr-muted-1">
          {success.fullName} has been assigned with {success.vehicleLabel}. The guest has been notified on WhatsApp.
        </p>
        <p className="mt-3 font-archivo text-sm text-kmr-muted-1">You can close this page and return to WhatsApp.</p>
      </div>
    )
  }

  const showConflictCard = apiError?.code === "existing_driver_name_mismatch" && apiError.existingDriver
  const errorBanner =
    apiError && !showConflictCard ? (
      <p role="alert" className="font-archivo text-sm font-semibold text-kmr-orange">
        {apiError.message}
      </p>
    ) : null
  const conflictCard = showConflictCard ? (
    <div role="alert" className="flex flex-col gap-2 rounded-sm bg-kmr-orange/10 p-3">
      <p className="font-archivo text-sm text-kmr-ink">{apiError!.message}</p>
      <Button type="button" variant="secondary" onClick={handleUseExistingFromConflict}>
        Use {apiError!.existingDriver!.fullName} instead
      </Button>
    </div>
  ) : null

  return (
    <div className="flex flex-col gap-4">
      <details
        open={summaryOpen}
        onToggle={(event) => setSummaryOpen(event.currentTarget.open)}
        className="rounded-sm bg-kmr-surface p-3"
      >
        <summary className="cursor-pointer font-archivo text-sm font-semibold text-kmr-ink" tabIndex={0}>
          {booking.guestName} · {booking.routeLabel}
        </summary>
        <div className="mt-2 flex flex-col gap-1 font-archivo text-sm text-kmr-ink">
          <span>Date: {booking.dateLabel}</span>
          <span>{booking.paxAndVehicleLabel}</span>
          <span>Total: {booking.totalLabel}</span>
        </div>
      </details>

      {driverOptions.length > 0 ? (
        <div role="tablist" aria-label="Choose how to assign a driver" className="flex gap-1 rounded-sm bg-kmr-surface p-1">
          <button
            type="button"
            role="tab"
            aria-selected={flow === "existing"}
            onClick={() => handleSetFlow("existing")}
            tabIndex={0}
            className={cn(
              "flex-1 rounded-sm px-3 py-2 font-archivo text-sm font-semibold transition-colors",
              flow === "existing" ? "bg-white text-kmr-ink shadow-sm" : "text-kmr-muted-1",
            )}
          >
            Saved driver
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={flow === "manual"}
            onClick={() => handleSetFlow("manual")}
            tabIndex={0}
            className={cn(
              "flex-1 rounded-sm px-3 py-2 font-archivo text-sm font-semibold transition-colors",
              flow === "manual" ? "bg-white text-kmr-ink shadow-sm" : "text-kmr-muted-1",
            )}
          >
            New driver
          </button>
        </div>
      ) : (
        <p className="font-archivo text-xs text-kmr-muted-1">No saved drivers yet for this operator — add the first one below.</p>
      )}

      {flow === "existing" ? (
        <div className="flex flex-col gap-3">
          <label htmlFor="assign-driver-search" className="flex flex-col gap-1 text-left">
            <span className="font-mono text-[9.5px] font-semibold tracking-[0.5px] text-kmr-muted-2">SEARCH SAVED DRIVERS</span>
            <input
              id="assign-driver-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, phone, or vehicle number"
              aria-label="Search saved drivers"
              tabIndex={0}
              className="rounded-sm bg-kmr-surface px-3 py-3 font-archivo text-[15px] text-kmr-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kmr-blue"
            />
          </label>

          <div role="listbox" aria-label="Saved drivers" className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <p className="px-1 py-2 font-archivo text-sm text-kmr-muted-1">No saved drivers match &ldquo;{query}&rdquo;.</p>
            ) : (
              filteredOptions.map((option) => (
                <DriverOptionRow
                  key={option.driverId}
                  option={option}
                  selected={option.driverId === selectedDriverId}
                  onSelect={() => handleSelectDriver(option)}
                />
              ))
            )}
          </div>

          {selectedOption && (
            <div className="flex flex-col gap-3 rounded-sm bg-kmr-surface p-3">
              <div>
                <p className="font-archivo text-[15px] font-semibold text-kmr-ink">{selectedOption.fullName}</p>
                <p className="font-archivo text-xs text-kmr-muted-1">•••• {selectedOption.phoneLast10.slice(-4)}</p>
              </div>
              <div className="flex gap-1.5">
                <PhotoChip label="Driver photo" available={selectedOption.hasDriverPhoto} />
                <PhotoChip label="Car photo" available={selectedOption.hasVehiclePhoto} />
              </div>

              {selectedOption.primaryVehicleId && (
                <button
                  type="button"
                  onClick={handleToggleDifferentVehicle}
                  tabIndex={0}
                  className="self-start font-archivo text-xs font-semibold text-kmr-blue hover:underline"
                >
                  {addVehicleForSelected ? "Use saved vehicle instead" : "Use a different vehicle for this trip"}
                </button>
              )}

              {addVehicleForSelected && (
                <div className="flex flex-col gap-3 rounded-sm bg-white p-3">
                  <p className="font-archivo text-xs font-semibold text-kmr-muted-1">
                    {selectedOption.primaryVehicleId ? "Vehicle for this trip" : "Add this driver's vehicle — none on file yet"}
                  </p>
                  <Field
                    label="Vehicle number"
                    value={selectedVehicleNumber}
                    onChange={(value) => setSelectedVehicleNumber(value.toUpperCase())}
                    placeholder="e.g. JK01AB1234"
                    required
                  />
                  <Field
                    label="Vehicle model"
                    value={selectedVehicleModel}
                    onChange={setSelectedVehicleModel}
                    placeholder="e.g. Swift Dzire"
                    required
                  />
                </div>
              )}
            </div>
          )}

          {conflictCard}
          {errorBanner}

          <div className="sticky bottom-0 -mx-6 -mb-6 bg-white px-6 pb-6 pt-2">
            <Button
              type="button"
              disabled={!selectedOption}
              loading={submitting}
              loadingLabel="Assigning…"
              onClick={handleSubmitExisting}
            >
              {selectedOption ? `Assign ${selectedOption.fullName}` : "Select a driver above"}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmitManual} className="flex flex-col gap-3">
          <Field
            label="Driver name"
            value={manualFields.driverName}
            onChange={updateManualField("driverName")}
            placeholder="e.g. Bilal Ahmed"
            required
          />
          <Field
            label="Driver phone"
            value={manualFields.driverPhone}
            onChange={updateManualField("driverPhone")}
            placeholder="e.g. 9876543210"
            type="tel"
            hint="10-digit mobile number"
            required
          />
          <Field
            label="Vehicle number"
            value={manualFields.vehicleNumber}
            onChange={(value) => updateManualField("vehicleNumber")(value.toUpperCase())}
            placeholder="e.g. JK01AB1234"
            required
          />
          <Field
            label="Vehicle model"
            value={manualFields.vehicleModel}
            onChange={updateManualField("vehicleModel")}
            placeholder="e.g. Swift Dzire"
            required
          />

          {conflictCard}
          {errorBanner}

          <div className="sticky bottom-0 -mx-6 -mb-6 bg-white px-6 pb-6 pt-2">
            <Button type="submit" loading={submitting} loadingLabel="Assigning…">
              Assign driver
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function PhotoChip({ label, available }: { label: string; available: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.3px]",
        available ? "bg-kmr-green/10 text-kmr-green" : "bg-kmr-muted-2/10 text-kmr-muted-2",
      )}
    >
      {available ? "✓" : "–"} {label}
    </span>
  )
}

function DriverOptionRow({
  option,
  selected,
  onSelect,
}: {
  option: VendorDriverOption
  selected: boolean
  onSelect: () => void
}) {
  const vehicleLabel =
    option.registrationNumber && option.model ? `${option.model} · ${option.registrationNumber}` : "No vehicle on file"
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      tabIndex={0}
      className={cn(
        "flex w-full flex-col items-start gap-1 rounded-sm border px-3 py-2.5 text-left transition-colors",
        selected ? "border-kmr-blue bg-kmr-blue/5" : "border-transparent bg-kmr-surface hover:bg-kmr-surface-hover",
      )}
    >
      <span className="font-archivo text-[15px] font-semibold text-kmr-ink">{option.fullName}</span>
      <span className="font-archivo text-xs text-kmr-muted-1">
        •••• {option.phoneLast10.slice(-4)} · {vehicleLabel}
      </span>
      <span className="flex gap-1.5">
        <PhotoChip label="Driver photo" available={option.hasDriverPhoto} />
        <PhotoChip label="Car photo" available={option.hasVehiclePhoto} />
      </span>
    </button>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  required?: boolean
  hint?: string
}) {
  const id = `assign-driver-${label.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-left">
      <span className="font-mono text-[9.5px] font-semibold tracking-[0.5px] text-kmr-muted-2">{label.toUpperCase()}</span>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        aria-label={label}
        tabIndex={0}
        className="rounded-sm bg-kmr-surface px-3 py-3 font-archivo text-[15px] text-kmr-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kmr-blue"
      />
      {hint && <span className="font-archivo text-[11px] text-kmr-muted-2">{hint}</span>}
    </label>
  )
}
