"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/Button"

interface AssignDriverFormProps {
  token: string
}

type FieldKey = "driverName" | "driverPhone" | "vehicleNumber" | "vehicleModel"

type FieldState = Record<FieldKey, string>

const EMPTY_FIELDS: FieldState = {
  driverName: "",
  driverPhone: "",
  vehicleNumber: "",
  vehicleModel: "",
}

/**
 * Submitted from app/vendor/assign-driver (linked from the vendor's
 * WhatsApp "Assign driver" CTA). Posts to app/api/vendor/assign-driver,
 * which shares the same upsert/attach logic as the legacy free-text
 * `DRIVER: ...` WhatsApp reply (lib/whatsapp/assignDriverToBooking.ts) —
 * either path produces an identical booking outcome.
 */
export function AssignDriverForm({ token }: AssignDriverFormProps) {
  const [fields, setFields] = useState<FieldState>(EMPTY_FIELDS)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const updateField = (key: FieldKey) => (value: string) => {
    setFields((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/vendor/assign-driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          driver_name: fields.driverName,
          driver_phone: fields.driverPhone,
          vehicle_number: fields.vehicleNumber,
          vehicle_model: fields.vehicleModel,
        }),
      })

      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.")
        return
      }

      setSuccess(true)
    } catch {
      setError("Network error — please check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-sm bg-kmr-surface p-4 text-center">
        <p className="font-archivo text-[15px] font-bold text-kmr-green">Driver assigned</p>
        <p className="mt-1 font-archivo text-sm text-kmr-muted-1">
          The guest has been notified on WhatsApp. Thank you!
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field
        label="Driver name"
        value={fields.driverName}
        onChange={updateField("driverName")}
        placeholder="e.g. Bilal Ahmed"
        required
      />
      <Field
        label="Driver phone"
        value={fields.driverPhone}
        onChange={updateField("driverPhone")}
        placeholder="e.g. 9876543210"
        type="tel"
        required
      />
      <Field
        label="Vehicle number"
        value={fields.vehicleNumber}
        onChange={updateField("vehicleNumber")}
        placeholder="e.g. JK01AB1234"
        required
      />
      <Field
        label="Vehicle model"
        value={fields.vehicleModel}
        onChange={updateField("vehicleModel")}
        placeholder="e.g. Swift Dzire"
        required
      />

      {error && (
        <p role="alert" className="font-archivo text-sm font-semibold text-kmr-orange">
          {error}
        </p>
      )}

      <Button type="submit" loading={submitting} loadingLabel="Assigning…">
        Assign driver
      </Button>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  required?: boolean
}) {
  const id = `assign-driver-${label.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-left">
      <span className="font-mono text-[9.5px] font-semibold tracking-[0.5px] text-kmr-muted-2">
        {label.toUpperCase()}
      </span>
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
    </label>
  )
}
