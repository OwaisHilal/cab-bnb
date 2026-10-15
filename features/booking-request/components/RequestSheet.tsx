"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { CalendarIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";
import { UPCOMING_DATES, VEHICLE_TYPES } from "@/features/booking-request/constants";
import { resolveTripStartDate } from "@/features/booking-request/resolveTripStartDate";
import { DateChipScrollRow } from "@/features/booking-request/components/DateChipScrollRow";
import { DatePickChip } from "@/features/booking-request/components/DatePickChip";
import { LaterDatePickChip } from "@/features/booking-request/components/LaterDatePickChip";
import { getDateChipParts, getTodayIsoDate } from "@/features/booking-request/upcomingDates";
import type {
  BookingRequestDraft,
  BookingRequestStep,
} from "@/features/booking-request/types";

const STEP_LABELS = ["DURATION", "TRAVELLERS", "VEHICLE", "DATE & SUMMARY"];

interface RequestSheetProps {
  step: BookingRequestStep;
  draft: BookingRequestDraft;
  recommendation: string | null;
  requestError: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onStepChange: (step: BookingRequestStep) => void;
  onDaysChange: (delta: number) => void;
  onPaxChange: (delta: number) => void;
  onVehicleChange: (vehicleType: BookingRequestDraft["vehicleType"]) => void;
  onSelectDate: (dateId: string) => void;
  onCustomDate: (isoDate: string) => void;
  onSubmit: () => void;
}

export function RequestSheet({
  step,
  draft,
  recommendation,
  requestError,
  isSubmitting,
  onClose,
  onStepChange,
  onDaysChange,
  onPaxChange,
  onVehicleChange,
  onSelectDate,
  onCustomDate,
  onSubmit,
}: RequestSheetProps) {
  const canGoBack = step > 0;
  const canGetQuotes = canSubmitBookingSummary(draft);

  const handlePrimaryAction = () => {
    if (step < 3) {
      onStepChange((step + 1) as BookingRequestStep);
      return;
    }
    onSubmit();
  };

  return (
    <>
      <div
        className="absolute inset-0 animate-kmr-fade bg-black/45"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
        aria-hidden
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[92%] flex-col rounded-t-xl bg-white px-5 pt-3 animate-kmr-sheet-up",
          step >= 2 && "min-h-[min(92vh,520px)]",
        )}
      >
        <div className="flex shrink-0 flex-col gap-3.5">
          <span className="mx-auto h-1 w-9 rounded-full bg-black/15" />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (isSubmitting) return;
                if (canGoBack) onStepChange((step - 1) as BookingRequestStep);
                else onClose();
              }}
              disabled={isSubmitting}
              aria-label="Back"
              className="flex size-8 items-center justify-center rounded-sm bg-kmr-surface font-archivo text-base font-semibold text-kmr-ink disabled:opacity-50"
            >
              ‹
            </button>
            <span
              key={step}
              aria-live="polite"
              className="animate-kmr-step-label-fade font-mono text-[9.5px] font-semibold tracking-[1.5px] text-kmr-muted-2"
            >
              {STEP_LABELS[step]}
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-sm bg-kmr-surface font-archivo text-sm font-semibold text-kmr-ink disabled:opacity-50"
            >
              ×
            </button>
          </div>

          <StepProgress step={step} />
        </div>

        <div
          className={cn(
            "overflow-y-auto pb-3.5",
            step >= 2
              ? "min-h-0 flex-1"
              : "flex flex-col justify-center py-2",
          )}
        >
          <StepContentFade step={step}>
            {step === 0 && <StepDays days={draft.days} onDaysChange={onDaysChange} />}
            {step === 1 && (
              <StepTravellers paxCount={draft.paxCount} onPaxChange={onPaxChange} />
            )}
            {step === 2 && (
              <StepVehicle
                selected={draft.vehicleType}
                paxCount={draft.paxCount}
                recommendation={recommendation}
                onSelect={onVehicleChange}
              />
            )}
            {step === 3 && (
              <StepSummary
                draft={draft}
                recommendation={recommendation}
                requestError={requestError}
                onSelectDate={onSelectDate}
                onCustomDate={onCustomDate}
                onEditDays={() => onStepChange(0)}
                onEditPax={() => onStepChange(1)}
                onEditVehicle={() => onStepChange(2)}
              />
            )}
          </StepContentFade>
        </div>

        <div
          className="shrink-0 border-t border-black/5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          {step < 3 ? (
            <Button onClick={handlePrimaryAction} disabled={isSubmitting}>
              Continue
            </Button>
          ) : (
            <Button
              onClick={handlePrimaryAction}
              loading={isSubmitting}
              loadingLabel="Matching operators…"
              disabled={!canGetQuotes}
            >
              Get my quotes
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function canSubmitBookingSummary(draft: BookingRequestDraft): boolean {
  return resolveTripStartDate(draft) !== null;
}

function StepContentFade({
  step,
  children,
}: {
  step: BookingRequestStep;
  children: ReactNode;
}) {
  return (
    <div key={step} className="animate-kmr-step-fade flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}

function StepProgress({ step }: { step: BookingRequestStep }) {
  const nodes: BookingRequestStep[] = [0, 1, 2, 3];
  const fillPercent = (step / 3) * 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={step + 1}
      aria-valuemin={1}
      aria-valuemax={4}
      aria-label={`Step ${step + 1} of 4`}
      className="relative py-1"
    >
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-black/10" aria-hidden="true" />
      <div
        className="kmr-progress-fill absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-kmr-blue"
        style={{ width: `${fillPercent}%` }}
        aria-hidden="true"
      />
      <div className="relative z-10 flex items-center justify-between">
        {nodes.map((node, index) => {
          const isActive = node === step;
          const isComplete = node < step;

          return (
            <span
              key={node}
              className={cn(
                "kmr-step-dot size-2 rounded-full",
                isComplete || isActive ? "bg-kmr-blue" : "bg-black/10",
                isActive && "scale-110",
              )}
              style={{ transitionDelay: `${index * 25}ms` }}
              aria-hidden="true"
            />
          );
        })}
      </div>
    </div>
  );
}

function CounterStepLayout({
  title,
  value,
  decreaseLabel,
  increaseLabel,
  onDecrease,
  onIncrease,
  helper,
}: {
  title: string;
  value: number;
  decreaseLabel: string;
  increaseLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  helper: string;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <h2
        className="min-h-[4.75rem] font-archivo text-[22px] font-extrabold leading-[1.15] tracking-[-0.5px] text-kmr-ink"
      >
        {title}
      </h2>
      <div className="flex items-center justify-center gap-5 py-2">
        <StepperButton label={decreaseLabel} onClick={onDecrease}>
          −
        </StepperButton>
        <span className="min-w-[96px] text-center font-archivo text-[62px] font-black leading-none tracking-[-2px] text-kmr-blue">
          {value}
        </span>
        <StepperButton label={increaseLabel} onClick={onIncrease}>
          +
        </StepperButton>
      </div>
      <div className="flex min-h-[3.5rem] items-center justify-center">
        <p className="text-center font-archivo text-[11.5px] font-medium leading-[1.5] text-kmr-muted-2">
          {helper}
        </p>
      </div>
    </div>
  );
}

function StepDays({
  days,
  onDaysChange,
}: {
  days: number;
  onDaysChange: (delta: number) => void;
}) {
  return (
    <CounterStepLayout
      title="How many days should your cab stay with you?"
      value={days}
      decreaseLabel="Decrease days"
      increaseLabel="Increase days"
      onDecrease={() => onDaysChange(-1)}
      onIncrease={() => onDaysChange(1)}
      helper="Airport to airport. Most first-timers do 4–5 days — Srinagar, Gulmarg, Pahalgam, done properly."
    />
  );
}

function StepTravellers({
  paxCount,
  onPaxChange,
}: {
  paxCount: number;
  onPaxChange: (delta: number) => void;
}) {
  return (
    <CounterStepLayout
      title="How many of you are coming?"
      value={paxCount}
      decreaseLabel="Decrease travellers"
      increaseLabel="Increase travellers"
      onDecrease={() => onPaxChange(-1)}
      onIncrease={() => onPaxChange(1)}
      helper="We match vehicle capacity to your group automatically on the next step."
    />
  );
}

function StepVehicle({
  selected,
  paxCount,
  recommendation,
  onSelect,
}: {
  selected: BookingRequestDraft["vehicleType"];
  paxCount: number;
  recommendation: string | null;
  onSelect: (vehicleType: BookingRequestDraft["vehicleType"]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-archivo text-[22px] font-extrabold leading-[1.15] tracking-[-0.5px] text-kmr-ink">
        What kind of ride suits you?
      </h2>
      <div className="flex flex-col gap-2">
        {VEHICLE_TYPES.map((vehicle) => {
          const isActive = selected === vehicle.code;
          return (
            <button
              key={vehicle.code}
              type="button"
              onClick={() => onSelect(vehicle.code)}
              className={cn(
                "flex items-center gap-3 rounded-sm p-3 text-left transition-colors",
                isActive ? "bg-kmr-blue/10" : "bg-kmr-surface hover:bg-kmr-surface-hover",
              )}
            >
              <span
                className="relative size-11 flex-none overflow-hidden rounded-sm bg-white ring-1 ring-black/5"
                aria-hidden
              >
                <Image
                  src={vehicle.iconSrc}
                  alt=""
                  fill
                  sizes="44px"
                  className="object-contain p-1"
                />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    "font-archivo text-[15px] font-bold",
                    isActive ? "text-kmr-blue" : "text-kmr-ink",
                  )}
                >
                  {vehicle.label}
                </span>
                <span className="font-mono text-[9.5px] font-medium tracking-[0.3px] text-kmr-muted-2">
                  {vehicle.who}
                </span>
              </span>
              <span
                className={cn(
                  "size-4 flex-none rounded-full border-2 shadow-[inset_0_0_0_2.5px_#fff]",
                  isActive ? "border-kmr-blue bg-kmr-blue" : "border-kmr-muted-3 bg-white",
                )}
              />
            </button>
          );
        })}
      </div>
      {recommendation && paxCount > 0 && (
        <p className="font-archivo text-xs font-medium text-kmr-blue">{recommendation}</p>
      )}
      <span className="text-center font-mono text-[9px] font-medium tracking-[1px] text-kmr-muted-3">
        NO FIXED FARES HERE — OPERATORS QUOTE, YOU CHOOSE
      </span>
    </div>
  );
}

function StepSummary({
  draft,
  recommendation,
  requestError,
  onSelectDate,
  onCustomDate,
  onEditDays,
  onEditPax,
  onEditVehicle,
}: {
  draft: BookingRequestDraft;
  recommendation: string | null;
  requestError: string | null;
  onSelectDate: (dateId: string) => void;
  onCustomDate: (isoDate: string) => void;
  onEditDays: () => void;
  onEditPax: () => void;
  onEditVehicle: () => void;
}) {
  const [isLaterPickerOpen, setIsLaterPickerOpen] = useState(false);
  const vehicleLabel =
    VEHICLE_TYPES.find((vehicle) => vehicle.code === draft.vehicleType)?.label ?? "cab";
  const customDateValue = draft.customDate?.trim() ?? "";
  const hasCustomDate = customDateValue.length > 0;
  const minTripDate = getTodayIsoDate();

  const handleCustomDateChange = (isoDate: string) => {
    if (!isoDate.trim()) return;
    onCustomDate(isoDate);
  };

  const laterChipParts = hasCustomDate
    ? getDateChipParts(customDateValue)
    : { weekday: "", primary: "Later" };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-archivo text-[22px] font-extrabold leading-[1.15] tracking-[-0.5px] text-kmr-ink">
          Lovely. When do you land?
        </h2>
        <p className="font-archivo text-xs font-medium text-kmr-muted-2">
          Pick a departure date and we&apos;ll do the rest.
        </p>
      </div>

      <div className="flex items-start gap-2">
        <DateChipScrollRow>
          {UPCOMING_DATES.map((date) => {
            const isActive =
              draft.selectedDateId === date.id && !isLaterPickerOpen;
            const chipParts = getDateChipParts(date.isoDate);
            return (
              <div key={date.id} className="shrink-0 snap-start">
                <DatePickChip
                  selected={isActive}
                  onClick={() => onSelectDate(date.id)}
                  weekday={chipParts.weekday}
                  primary={chipParts.primary}
                />
              </div>
            );
          })}
        </DateChipScrollRow>
        <LaterDatePickChip
          minDate={minTripDate}
          value={customDateValue}
          selected={hasCustomDate || isLaterPickerOpen}
          weekday={laterChipParts.weekday}
          primary={laterChipParts.primary}
          icon={
            hasCustomDate ? undefined : (
              <CalendarIcon size={12} className="text-kmr-ink" />
            )
          }
          onFocus={() => setIsLaterPickerOpen(true)}
          onBlur={() => setIsLaterPickerOpen(false)}
          onChange={handleCustomDateChange}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-sm bg-[#F6F6F7] p-4">
        <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          YOUR PACKAGE — TAP ANYTHING TO CHANGE IT
        </span>
        <p className="font-archivo text-[19px] font-bold leading-[1.5] tracking-[-0.3px] text-kmr-ink">
          <button
            type="button"
            onClick={onEditDays}
            className="border-b-2 border-kmr-orange/70 text-kmr-blue"
          >
            {draft.days} days
          </button>{" "}
          in the valley,{" "}
          <button
            type="button"
            onClick={onEditPax}
            className="border-b-2 border-kmr-orange/70 text-kmr-blue"
          >
            {draft.paxCount} travellers
          </button>
          , one{" "}
          <button
            type="button"
            onClick={onEditVehicle}
            className="border-b-2 border-kmr-orange/70 text-kmr-blue"
          >
            {vehicleLabel}
          </button>
          .
        </p>
        {recommendation && (
          <p className="font-archivo text-[11.5px] font-medium leading-[1.5] text-[#3C3F52]">
            {recommendation}
          </p>
        )}
      </div>

      {requestError && (
        <span className="text-center font-mono text-[10px] font-semibold text-kmr-orange">
          {requestError}
        </span>
      )}
    </div>
  );
}

function StepperButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-sm bg-kmr-surface font-archivo text-lg font-semibold text-kmr-ink transition-colors hover:bg-kmr-surface-hover"
    >
      {children}
    </button>
  );
}
