"use client"

import { useEffect, useRef } from "react"
import type { GuestStep, GuestTripSnapshot } from "@/lib/guest-trip/types"
import { useGuestTrip } from "@/features/guest-trip/hooks/useGuestTrip"
import { formatInr } from "@/lib/whatsapp/formatInr"
import { cn } from "@/lib/utils/cn"

interface GuestTripScreenProps {
  sessionId: string
  confirming: "token" | "balance" | null
  notice: string | null
  onMissing: () => void
  onClosed: () => void
  onCancel: () => void
  onStartRequest: () => void
  onContinue: () => void
  onSnapshot?: (snapshot: GuestTripSnapshot) => void
  active?: boolean
}

const STATUS_CHECK_LABEL = "Already booked? Check your trip"

const phoneDigits = (phone: string): string => phone.replace(/[^\d]/g, "")

const headlineFor = (step: GuestStep): string => {
  if (step === "quotes_waiting") return "Quotes are on the way."
  if (step === "quotes") return "Quotes are in."
  if (step === "lock") return "Lock this cab."
  if (step === "balance") return "Your driver is assigned."
  if (step === "token_received" || step === "driver_contact") return "Payment received."
  return "This trip is closed."
}

const kickerFor = (step: GuestStep): string => {
  if (step === "quotes_waiting") return "MATCHING OPERATORS"
  if (step === "quotes") return "CHOOSE AN OPERATOR"
  if (step === "lock") return "PAY THE TOKEN"
  if (step === "token_received") return "WAITING FOR A DRIVER"
  if (step === "balance") return "PAY THE BALANCE"
  if (step === "driver_contact") return "DRIVER CONFIRMED"
  return "CLOSED"
}

const payLabel = (snapshot: GuestTripSnapshot): string => {
  if (snapshot.step === "balance" && snapshot.balanceAmount !== null) {
    return `Pay ${formatInr(snapshot.balanceAmount)}`
  }
  return `Pay ${formatInr(snapshot.tokenAmount ?? 99)}`
}

export const GuestTripScreen = ({
  sessionId,
  confirming,
  notice,
  onMissing,
  onClosed,
  onCancel,
  onStartRequest,
  onContinue,
  onSnapshot,
  active = true,
}: GuestTripScreenProps) => {
  const trip = useGuestTrip(sessionId, confirming, active)
  const snapshot = trip.snapshot
  const reportedMissing = useRef(false)
  const reportedSnapshot = useRef<string | null>(null)

  useEffect(() => {
    if (trip.rawStep === "closed") onClosed()
  }, [onClosed, trip.rawStep])

  useEffect(() => {
    if (!trip.missing || reportedMissing.current) return
    reportedMissing.current = true
    onMissing()
  }, [onMissing, trip.missing])

  useEffect(() => {
    if (!snapshot || !onSnapshot) return
    const key = `${snapshot.tripRequestId}:${snapshot.tripSummary}`
    if (reportedSnapshot.current === key) return
    reportedSnapshot.current = key
    onSnapshot(snapshot)
  }, [onSnapshot, snapshot])

  const handleCancel = async () => {
    const cancelled = await trip.handleCancel()
    if (cancelled) onCancel()
  }

  if (trip.missing && !snapshot) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-[30px] pb-[90px] text-center">
        <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">NO ACTIVE BOOKING</span>
        <h1 className="font-archivo text-2xl font-extrabold tracking-[-0.5px] text-kmr-ink">Check a booking, or start one.</h1>
        <button
          type="button"
          aria-label={STATUS_CHECK_LABEL}
          onClick={onContinue}
          className="rounded-sm bg-kmr-blue px-5 py-3 font-archivo text-sm font-bold text-white"
        >
          {STATUS_CHECK_LABEL}
        </button>
        <button
          type="button"
          aria-label="Add cabs to your trip"
          onClick={onStartRequest}
          className="font-archivo text-sm font-bold text-kmr-ink underline"
        >
          Add cabs to your trip
        </button>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-[30px] pb-[90px] text-center">
        {trip.loadError ? (
          <p role="alert" className="font-archivo text-sm font-medium text-kmr-ink">
            {trip.loadError}
          </p>
        ) : (
          <p className="font-archivo text-sm font-medium text-kmr-muted-1">Loading your trip.</p>
        )}
      </div>
    )
  }

  const showQuotes = snapshot.step === "quotes" && !trip.confirmingPayment
  const showPay =
    (snapshot.step === "lock" || snapshot.step === "balance") && !snapshot.hidePay && !trip.confirmingPayment
  const showConfirming = trip.confirmingPayment && (snapshot.step === "lock" || snapshot.step === "balance")

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-[30px] pb-[90px] pt-[30px]">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[8.5px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          {kickerFor(snapshot.step)}
        </span>
        <h1 className="font-archivo text-[30px] font-extrabold leading-[1.1] tracking-[-0.8px] text-kmr-ink">
          {headlineFor(snapshot.step)}
        </h1>
        <p className="font-archivo text-[13.5px] font-bold leading-[1.4] tracking-[-0.2px] text-kmr-blue">
          {snapshot.tripSummary}
        </p>
      </div>

      {notice ? (
        <p className="font-archivo text-sm font-bold text-kmr-ink" role="status">
          {notice}
        </p>
      ) : null}
      {showConfirming ? (
        <p className="font-archivo text-sm font-bold text-kmr-ink">Confirming your payment.</p>
      ) : null}
      {trip.loadError ? (
        <p role="alert" className="font-archivo text-sm font-medium text-kmr-ink">
          {trip.loadError}
        </p>
      ) : null}

      {snapshot.step === "quotes_waiting" ? (
        <div className="rounded-sm bg-kmr-surface p-4">
          <p className="font-archivo text-sm font-medium leading-[1.55] text-kmr-ink">
            Your Kashmir cab quotes are on the way.
          </p>
        </div>
      ) : null}

      {showQuotes ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[8.5px] font-semibold tracking-[1.2px] text-kmr-muted-3">
            TAP TO CHOOSE YOUR OPERATOR
          </span>
          {snapshot.quotes.map((quote) => (
            <button
              key={quote.id}
              type="button"
              aria-label={`Select ${quote.vendorName}`}
              disabled={trip.selecting}
              onClick={() => {
                void trip.handleSelect(quote.id)
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-sm border border-transparent bg-kmr-surface px-3.5 py-[15px] text-left transition-colors hover:border-kmr-blue/20",
                trip.selecting && "opacity-60",
              )}
            >
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="font-archivo text-[15px] font-extrabold text-kmr-ink">{quote.vendorName}</span>
                  {quote.isBestPrice ? (
                    <span className="rounded-sm bg-kmr-blue/15 px-[5px] py-0.5 font-mono text-[7.5px] font-bold tracking-[1px] text-kmr-blue">
                      BEST
                    </span>
                  ) : null}
                </span>
                {quote.rating !== null ? (
                  <span className="font-mono text-[10px] font-semibold tracking-[0.4px] text-kmr-muted-2">
                    {quote.rating.toFixed(1)}
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-sm font-bold tracking-[0.5px] text-kmr-blue">
                {formatInr(quote.pricePerDay)}/day
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {snapshot.step === "lock" || snapshot.step === "balance" ? (
        <div className="flex flex-col gap-3 rounded-sm bg-kmr-surface p-4">
          {snapshot.operatorName ? (
            <div className="flex items-start justify-between gap-3">
              <span className="font-archivo text-[15px] font-extrabold text-kmr-ink">{snapshot.operatorName}</span>
              {snapshot.pricePerDay !== null ? (
                <span className="font-mono text-sm font-bold text-kmr-blue">{formatInr(snapshot.pricePerDay)}/day</span>
              ) : null}
            </div>
          ) : null}
          {snapshot.dayLines.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {snapshot.dayLines.map((line) => (
                <li key={line} className="font-archivo text-sm font-medium text-kmr-ink">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-col gap-1 border-t border-black/10 pt-3">
            {snapshot.totalAmount !== null ? (
              <p className="font-archivo text-sm font-medium text-kmr-ink">Total {formatInr(snapshot.totalAmount)}</p>
            ) : null}
            {snapshot.tokenAmount !== null ? (
              <p className="font-archivo text-sm font-medium text-kmr-ink">Token {formatInr(snapshot.tokenAmount)}</p>
            ) : null}
            {snapshot.balanceAmount !== null ? (
              <p className="font-archivo text-sm font-bold text-kmr-ink">Balance {formatInr(snapshot.balanceAmount)}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {snapshot.step === "token_received" ? (
        <div className="rounded-sm bg-kmr-surface p-4">
          <p className="font-archivo text-sm font-medium leading-[1.55] text-kmr-ink">
            Payment received. A driver is being assigned.
          </p>
        </div>
      ) : null}

      {snapshot.step === "driver_contact" ? (
        <div className="flex flex-col gap-2 rounded-sm bg-kmr-surface p-4">
          <span className="font-mono text-[8.5px] font-semibold tracking-[1.2px] text-kmr-green-dark">PAYMENT RECEIVED</span>
          {snapshot.driverName ? (
            <p className="font-archivo text-[15px] font-extrabold text-kmr-ink">{snapshot.driverName}</p>
          ) : null}
          {snapshot.driverPhone ? (
            <p className="font-archivo text-sm font-medium text-kmr-ink">{snapshot.driverPhone}</p>
          ) : null}
          {snapshot.vehicleLabel ? (
            <p className="font-archivo text-sm font-medium text-kmr-ink">
              {snapshot.vehicleLabel}
              {snapshot.vehicleNumber ? ` · ${snapshot.vehicleNumber}` : ""}
            </p>
          ) : null}
          {snapshot.operatorName ? (
            <p className="font-archivo text-sm font-medium text-kmr-muted-1">{snapshot.operatorName}</p>
          ) : null}
        </div>
      ) : null}

      {showPay ? (
        <button
          type="button"
          aria-label={payLabel(snapshot)}
          disabled={trip.paying}
          onClick={() => {
            void trip.handlePay()
          }}
          className="rounded-sm bg-kmr-green px-4 py-3 font-archivo text-sm font-bold text-white disabled:opacity-60"
        >
          {payLabel(snapshot)}
        </button>
      ) : null}

      {snapshot.driverPhone ? (
        <div className="flex flex-col gap-2">
          <a
            href={`tel:${snapshot.driverPhone}`}
            aria-label="Call driver"
            className="rounded-sm bg-kmr-blue px-4 py-3 text-center font-archivo text-sm font-bold text-white"
          >
            Call
          </a>
          <a
            href={`https://wa.me/${phoneDigits(snapshot.driverPhone)}`}
            aria-label="WhatsApp driver"
            className="rounded-sm bg-kmr-green px-4 py-3 text-center font-archivo text-sm font-bold text-white"
          >
            WhatsApp
          </a>
          {snapshot.rideGroupInviteUrl ? (
            <a
              href={snapshot.rideGroupInviteUrl}
              aria-label="Join ride group"
              className="rounded-sm border border-kmr-blue px-4 py-3 text-center font-archivo text-sm font-bold text-kmr-blue"
            >
              Join ride group
            </a>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        aria-label="Cancel request"
        disabled={trip.cancelling}
        onClick={() => {
          void handleCancel()
        }}
        className="font-archivo text-sm font-bold text-kmr-ink underline"
      >
        Cancel request
      </button>
    </div>
  )
}
