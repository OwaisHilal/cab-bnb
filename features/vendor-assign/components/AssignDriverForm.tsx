"use client"

import { useMemo, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/Button"
import { normalizeVehicleRegistration } from "@/lib/drivers/vehicle"
import type { VendorDriverOption } from "@/lib/vendor-assign/vendorDriverOptions"
import {
  AssignDriverCtaLabel,
  AssignDriverField,
  AssignDriverStickyFooter,
  AssignFlowTabs,
  AssignFormSection,
  BookingTripSummary,
  DriverOptionRow,
  DriverSearchField,
  SelectedDriverCard,
  type BookingTripSummaryData,
} from "@/features/vendor-assign/components/assignDriverFormUi"
import { formatDisplayName } from "@/features/vendor-assign/components/formatDisplayName"

export interface BookingSummaryForForm extends BookingTripSummaryData {}

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

export function AssignDriverForm({ token, booking, driverOptions }: AssignDriverFormProps) {
  const [flow, setFlow] = useState<Flow>(driverOptions.length > 0 ? "existing" : "manual")

  const [query, setQuery] = useState("")
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  const [syntheticSelectedDriver, setSyntheticSelectedDriver] = useState<VendorDriverOption | null>(null)
  const [addVehicleForSelected, setAddVehicleForSelected] = useState(false)
  const [selectedVehicleNumber, setSelectedVehicleNumber] = useState("")
  const [selectedVehicleModel, setSelectedVehicleModel] = useState("")

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

  const handleClearSelection = () => {
    setSelectedDriverId(null)
    setSyntheticSelectedDriver(null)
    setAddVehicleForSelected(false)
    setSelectedVehicleNumber("")
    setSelectedVehicleModel("")
    setApiError(null)
  }

  const handleSelectDriver = (option: VendorDriverOption) => {
    setSelectedDriverId(option.driverId)
    setSyntheticSelectedDriver(null)
    setApiError(null)
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
          {formatDisplayName(success.fullName)} has been assigned with {success.vehicleLabel}. The guest has been notified on WhatsApp.
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
        Use {formatDisplayName(apiError!.existingDriver!.fullName)} instead
      </Button>
    </div>
  ) : null

  return (
    <div className="flex flex-col gap-5 pb-2">
      <BookingTripSummary booking={booking} />

      {driverOptions.length > 0 ? (
        <AssignFlowTabs flow={flow} onFlowChange={handleSetFlow} />
      ) : (
        <p className="font-archivo text-xs text-kmr-muted-1">No saved drivers yet for this operator — add the first one below.</p>
      )}

      {flow === "existing" ? (
        <div
          id="assign-driver-panel-existing"
          role="tabpanel"
          aria-labelledby="assign-driver-tab-existing"
          className="flex flex-col gap-3"
        >
          {selectedOption ? (
            <SelectedDriverCard
              option={selectedOption}
              addVehicleForSelected={addVehicleForSelected}
              selectedVehicleNumber={selectedVehicleNumber}
              selectedVehicleModel={selectedVehicleModel}
              onChangeVehicle={(field, value) => {
                if (field === "number") setSelectedVehicleNumber(value)
                else setSelectedVehicleModel(value)
              }}
              onToggleDifferentVehicle={handleToggleDifferentVehicle}
              onChangeDriver={handleClearSelection}
            />
          ) : (
            <>
              <DriverSearchField value={query} onChange={setQuery} />
              <div role="listbox" aria-label="Saved drivers" className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {filteredOptions.length === 0 ? (
                  <p className="px-1 py-2 font-archivo text-sm text-kmr-muted-1">
                    No saved drivers match &ldquo;{query}&rdquo;.
                  </p>
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
            </>
          )}

          {conflictCard}
          {errorBanner}

          <AssignDriverStickyFooter>
            <Button
              type="button"
              disabled={!selectedOption}
              loading={submitting}
              loadingLabel="Assigning…"
              onClick={handleSubmitExisting}
            >
              <AssignDriverCtaLabel selectedName={selectedOption?.fullName ?? null} />
            </Button>
          </AssignDriverStickyFooter>
        </div>
      ) : (
        <form
          id="assign-driver-panel-manual"
          role="tabpanel"
          aria-labelledby="assign-driver-tab-manual"
          onSubmit={handleSubmitManual}
          className="flex flex-col gap-3"
        >
          <AssignFormSection title="Driver" description="Who will meet the guest and drive this trip?">
            <AssignDriverField
              label="Driver name"
              value={manualFields.driverName}
              onChange={updateManualField("driverName")}
              placeholder="e.g. Bilal Ahmed"
              autoComplete="name"
              required
            />
            <AssignDriverField
              label="Driver phone"
              value={manualFields.driverPhone}
              onChange={updateManualField("driverPhone")}
              placeholder="e.g. 9876543210"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              hint="10-digit mobile number"
              required
            />
          </AssignFormSection>

          <AssignFormSection title="Vehicle" description="Plate and model shown to the guest on WhatsApp." accent="orange">
            <AssignDriverField
              label="Vehicle number"
              value={manualFields.vehicleNumber}
              onChange={(value) => updateManualField("vehicleNumber")(value.toUpperCase())}
              placeholder="e.g. JK01AB1234"
              required
            />
            <AssignDriverField
              label="Vehicle model"
              value={manualFields.vehicleModel}
              onChange={updateManualField("vehicleModel")}
              placeholder="e.g. Swift Dzire"
              required
            />
          </AssignFormSection>

          {conflictCard}
          {errorBanner}

          <AssignDriverStickyFooter>
            <Button type="submit" loading={submitting} loadingLabel="Assigning…">
              Assign driver
            </Button>
          </AssignDriverStickyFooter>
        </form>
      )}
    </div>
  )
}
