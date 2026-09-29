"use client"

import { useEffect, useRef } from "react"
import type { GuestTripSnapshot } from "@/lib/guest-trip/types"
import { useGuestTrip } from "@/features/guest-trip/hooks/useGuestTrip"

interface GuestTripScreenProps {
  sessionId: string
  confirming: "token" | "balance" | null
  notice: string | null
  onMissing: () => void
  onClosed: () => void
  onCancel: () => void
  onStartRequest: () => void
  onContinue: () => void
}

const phoneDigits = (phone: string): string => phone.replace(/[^\d]/g, "")

const payLabel = (snapshot: GuestTripSnapshot): string => {
  if (snapshot.step !== "balance") return "Pay ₹99"
  const match = snapshot.bodyText.match(/Balance: (₹[^\n·]+)/)
  return match?.[1] ? `Pay ${match[1].trim()}` : "Pay"
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
}: GuestTripScreenProps) => {
  const trip = useGuestTrip(sessionId, confirming)
  const snapshot = trip.snapshot
  const reportedMissing = useRef(false)

  useEffect(() => {
    if (trip.rawStep === "closed") onClosed()
  }, [onClosed, trip.rawStep])

  useEffect(() => {
    if (!trip.missing || reportedMissing.current) return
    reportedMissing.current = true
    onMissing()
  }, [onMissing, trip.missing])

  const handleCancel = async () => {
    const cancelled = await trip.handleCancel()
    if (cancelled) onCancel()
  }

  if (trip.missing && !snapshot) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-[30px] pb-[90px] text-center">
        <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">NO ACTIVE BOOKING</span>
        <h1 className="font-archivo text-2xl font-extrabold tracking-[-0.5px] text-kmr-ink">Request your first quote.</h1>
        <button
          type="button"
          aria-label="Continue with your phone"
          onClick={onContinue}
          className="rounded-sm bg-kmr-blue px-5 py-3 font-archivo text-sm font-bold text-white"
        >
          Continue with your phone
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
  const showPay = (snapshot.step === "lock" || snapshot.step === "balance") && !snapshot.hidePay && !trip.confirmingPayment

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-[30px] pb-[90px] pt-[30px]">
      <p className="font-archivo text-[13.5px] font-bold tracking-[-0.2px] text-kmr-blue">{snapshot.tripSummary}</p>
      {notice ? (
        <p className="font-archivo text-sm font-bold text-kmr-ink" role="status">
          {notice}
        </p>
      ) : null}
      {trip.confirmingPayment ? (
        <p className="font-archivo text-sm font-bold text-kmr-ink">Confirming your payment.</p>
      ) : null}
      <p className="whitespace-pre-wrap font-archivo text-sm font-medium leading-[1.55] text-kmr-ink">{snapshot.bodyText}</p>
      {snapshot.footerText ? (
        <p className="whitespace-pre-wrap font-archivo text-xs font-medium text-kmr-muted-1">{snapshot.footerText}</p>
      ) : null}
      {trip.loadError ? (
        <p role="alert" className="font-archivo text-sm font-medium text-kmr-ink">
          {trip.loadError}
        </p>
      ) : null}
      {showQuotes ? (
        <div className="flex flex-col gap-2">
          {snapshot.quotes.map((quote) => (
            <button
              key={quote.id}
              type="button"
              aria-label={`Select ${quote.vendorName}`}
              disabled={trip.selecting}
              onClick={() => {
                void trip.handleSelect(quote.id)
              }}
              className="rounded-sm bg-kmr-blue px-4 py-3 text-left font-archivo text-sm font-bold text-white disabled:opacity-60"
            >
              {`Select ${quote.vendorName}`}
            </button>
          ))}
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
