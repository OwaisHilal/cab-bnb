"use client"

import { useEffect, useRef } from "react"
import type { GuestStep, GuestTripSnapshot } from "@/lib/guest-trip/types"
import { useGuestTrip } from "@/features/guest-trip/hooks/useGuestTrip"
import {
  GuestTripSkeleton,
  DriverCard,
  InlineAlert,
  QuoteOption,
  QuoteSkeletons,
  TripReceipt,
  TripSummaryPills,
} from "@/features/guest-trip/components/GuestTripParts"
import { Spinner } from "@/components/ui/Spinner"
import { StatusPanel } from "@/components/ui/StatusPanel"
import { BOOKING_STEP_LABELS, StepTracker } from "@/components/ui/StepTracker"
import { TopBar } from "@/components/ui/TopBar"
import {
  CarIcon,
  LockIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UsersGroupIcon,
  WhatsAppGlyphIcon,
} from "@/components/ui/icons"
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

/** Maps a guest step to its position in the visual progress tracker (display only). */
const trackerIndexFor = (step: GuestStep): number | null => {
  if (step === "quotes_waiting" || step === "quotes") return 0
  if (step === "lock") return 1
  if (step === "token_received") return 2
  if (step === "balance") return 3
  if (step === "driver_contact") return 4
  return null
}

const PRIMARY_BUTTON_CLASSES =
  "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md px-5 font-archivo text-[15px] font-extrabold tracking-[-0.2px] text-white transition-all active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kmr-blue disabled:cursor-not-allowed disabled:opacity-60"

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
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-[30px] pb-[90px] text-center animate-kmr-fade">
        <span className="flex size-16 items-center justify-center rounded-full bg-kmr-blue/10 text-kmr-blue">
          <CarIcon size={30} />
        </span>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">NO ACTIVE BOOKING</span>
          <h1 className="font-archivo text-2xl font-extrabold tracking-[-0.5px] text-kmr-ink">Check a booking, or start one.</h1>
        </div>
        <div className="flex w-full flex-col items-center gap-3">
          <button
            type="button"
            aria-label={STATUS_CHECK_LABEL}
            onClick={onContinue}
            className="min-h-[52px] w-full rounded-md bg-kmr-blue px-5 font-archivo text-[15px] font-extrabold text-white transition-colors hover:bg-kmr-blue-dark"
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
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-[30px] pb-[90px] pt-[30px] animate-kmr-fade">
        <TopBar />
        {trip.loadError ? (
          <InlineAlert tone="error">{trip.loadError}</InlineAlert>
        ) : (
          <>
            <p role="status" className="flex items-center gap-2 font-archivo text-sm font-medium text-kmr-muted-1">
              <Spinner tone="blue" />
              Loading your trip.
            </p>
            <GuestTripSkeleton />
          </>
        )}
      </div>
    )
  }

  const showQuotes = snapshot.step === "quotes" && !trip.confirmingPayment
  const showPay =
    (snapshot.step === "lock" || snapshot.step === "balance") && !snapshot.hidePay && !trip.confirmingPayment
  const showConfirming = trip.confirmingPayment && (snapshot.step === "lock" || snapshot.step === "balance")
  const trackerIndex = trackerIndexFor(snapshot.step)

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-[30px] pb-[90px] pt-[30px] animate-kmr-fade">
      <TopBar />

      {trackerIndex !== null ? <StepTracker steps={BOOKING_STEP_LABELS} current={trackerIndex} className="mt-1" /> : null}

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 font-mono text-[8.5px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          <span className="size-1.5 rounded-full bg-kmr-orange" aria-hidden="true" />
          {kickerFor(snapshot.step)}
        </span>
        <h1 className="font-archivo text-[30px] font-extrabold leading-[1.1] tracking-[-0.8px] text-kmr-ink">
          {headlineFor(snapshot.step)}
        </h1>
        <TripSummaryPills summary={snapshot.tripSummary} />
      </div>

      {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}
      {trip.loadError ? <InlineAlert tone="error">{trip.loadError}</InlineAlert> : null}

      {showConfirming ? (
        <StatusPanel
          pulse
          icon={<Spinner tone="blue" size="lg" />}
          title="Confirming your payment."
          description="Please don't close this page or press back. This usually takes a few seconds."
          liveLabel="WAITING FOR YOUR BANK"
        />
      ) : null}

      {snapshot.step === "quotes_waiting" ? (
        <>
          <StatusPanel
            pulse
            icon={<CarIcon size={26} />}
            title="Matching operators"
            description="Your Kashmir cab quotes are on the way. This page updates automatically, no need to refresh."
            liveLabel="CHECKING VERIFIED OPERATORS"
          />
          <QuoteSkeletons count={3} />
        </>
      ) : null}

      {showQuotes ? (
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[8.5px] font-semibold tracking-[1.2px] text-kmr-muted-3">
            TAP TO CHOOSE YOUR OPERATOR
          </span>
          {snapshot.quotes.map((quote) => (
            <QuoteOption
              key={quote.id}
              quote={quote}
              disabled={trip.selecting}
              onSelect={() => {
                void trip.handleSelect(quote.id)
              }}
            />
          ))}
          {trip.selecting ? (
            <p role="status" className="flex items-center justify-center gap-2 font-archivo text-[13px] font-bold text-kmr-blue">
              <Spinner tone="blue" size="sm" />
              Locking your cab…
            </p>
          ) : null}
        </div>
      ) : null}

      {snapshot.step === "lock" || snapshot.step === "balance" ? <TripReceipt snapshot={snapshot} /> : null}

      {snapshot.step === "token_received" ? (
        <StatusPanel
          pulse
          icon={<CarIcon size={26} />}
          title="Driver being assigned"
          description="Payment received. A driver is being assigned. This can take about 30 minutes, and you can close the app. We'll WhatsApp you as soon as your driver is confirmed."
          liveLabel="ASSIGNING YOUR DRIVER"
        />
      ) : null}

      {snapshot.step === "driver_contact" ? (
        <DriverCard
          driverName={snapshot.driverName}
          driverPhone={snapshot.driverPhone}
          vehicleLabel={snapshot.vehicleLabel}
          vehicleNumber={snapshot.vehicleNumber}
          operatorName={snapshot.operatorName}
        />
      ) : null}

      <div className="mt-auto flex flex-col gap-3 pt-2">
        {showPay ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-label={payLabel(snapshot)}
              aria-busy={trip.paying}
              disabled={trip.paying}
              onClick={() => {
                void trip.handlePay()
              }}
              className={cn(PRIMARY_BUTTON_CLASSES, "bg-kmr-green shadow-kmr-cta hover:bg-kmr-green-dark")}
            >
              {trip.paying ? (
                <>
                  <Spinner />
                  Opening secure checkout…
                </>
              ) : (
                <>
                  <LockIcon size={17} />
                  {payLabel(snapshot)}
                </>
              )}
            </button>
            <p className="flex items-center justify-center gap-1.5 font-mono text-[9px] font-semibold tracking-[0.8px] text-kmr-muted-2">
              <ShieldCheckIcon size={13} className="text-kmr-green-dark" />
              SECURE CHECKOUT BY CASHFREE
            </p>
          </div>
        ) : null}

        {snapshot.driverPhone ? (
          <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <a
                href={`tel:${snapshot.driverPhone}`}
                aria-label="Call driver"
                className={cn(PRIMARY_BUTTON_CLASSES, "bg-kmr-blue hover:bg-kmr-blue-dark")}
              >
                <PhoneIcon size={17} />
                Call
              </a>
              <a
                href={`https://wa.me/${phoneDigits(snapshot.driverPhone)}`}
                aria-label="WhatsApp driver"
                className={cn(PRIMARY_BUTTON_CLASSES, "bg-kmr-green hover:bg-kmr-green-dark")}
              >
                <WhatsAppGlyphIcon size={17} />
                WhatsApp
              </a>
            </div>
            {snapshot.rideGroupInviteUrl ? (
              <a
                href={snapshot.rideGroupInviteUrl}
                aria-label="Join ride group"
                className="flex min-h-[52px] items-center justify-center gap-2 rounded-md border-2 border-kmr-blue px-4 font-archivo text-[15px] font-extrabold text-kmr-blue transition-colors hover:bg-kmr-blue/5"
              >
                <UsersGroupIcon size={17} />
                Join ride group
              </a>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          aria-label="Cancel request"
          aria-busy={trip.cancelling}
          disabled={trip.cancelling}
          onClick={() => {
            void handleCancel()
          }}
          className="mx-auto inline-flex items-center gap-2 py-1 font-archivo text-sm font-bold text-kmr-muted-1 underline transition-colors hover:text-kmr-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {trip.cancelling ? <Spinner tone="ink" size="sm" /> : null}
          Cancel request
        </button>
      </div>
    </div>
  )
}
