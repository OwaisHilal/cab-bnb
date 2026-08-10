"use client";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { UPCOMING_DATES, VEHICLE_TYPES } from "@/features/booking-request/constants";
import type {
  BookingRequestDraft,
  BookingRequestStep,
} from "@/features/booking-request/types";

const STEP_LABELS = ["DURATION", "TRAVELLERS", "VEHICLE", "DATE & SUMMARY"];

interface RequestSheetProps {
  step: BookingRequestStep;
  draft: BookingRequestDraft;
  recommendation: string | null;
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

  return (
    <>
      <div
        className="absolute inset-0 animate-kmr-fade bg-black/45"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[92%] flex-col gap-3.5 overflow-y-auto rounded-t-xl bg-white px-5 pb-6 pt-3 animate-kmr-sheet-up">
        <span className="mx-auto h-1 w-9 rounded-full bg-black/15" />

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => (canGoBack ? onStepChange((step - 1) as BookingRequestStep) : onClose())}
            aria-label="Back"
            className="flex size-8 items-center justify-center rounded-sm bg-kmr-surface font-archivo text-base font-semibold text-kmr-ink"
          >
            ‹
          </button>
          <span className="font-mono text-[9.5px] font-semibold tracking-[1.5px] text-kmr-muted-2">
            {STEP_LABELS[step]}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm bg-kmr-surface font-archivo text-sm font-semibold text-kmr-ink"
          >
            ×
          </button>
        </div>

        <StepProgress step={step} />

        {step === 0 && <StepDays days={draft.days} onDaysChange={onDaysChange} onNext={() => onStepChange(1)} />}
        {step === 1 && (
          <StepTravellers
            paxCount={draft.paxCount}
            onPaxChange={onPaxChange}
            onNext={() => onStepChange(2)}
          />
        )}
        {step === 2 && (
          <StepVehicle
            selected={draft.vehicleType}
            paxCount={draft.paxCount}
            recommendation={recommendation}
            onSelect={onVehicleChange}
            onNext={() => onStepChange(3)}
          />
        )}
        {step === 3 && (
          <StepSummary
            draft={draft}
            recommendation={recommendation}
            onSelectDate={onSelectDate}
            onCustomDate={onCustomDate}
            onEditDays={() => onStepChange(0)}
            onEditPax={() => onStepChange(1)}
            onEditVehicle={() => onStepChange(2)}
            onSubmit={onSubmit}
          />
        )}
      </div>
    </>
  );
}

function StepProgress({ step }: { step: BookingRequestStep }) {
  const nodes = [0, 1, 2, 3];
  return (
    <div className="flex items-center">
      {nodes.map((node, index) => (
        <div key={node} className="flex flex-1 items-center last:flex-none">
          <span
            className={cn(
              "size-2 flex-none rounded-full",
              node <= step ? "bg-kmr-blue" : "bg-black/10",
            )}
          />
          {index < nodes.length - 1 && (
            <span
              className={cn("h-0.5 flex-1", node < step ? "bg-kmr-blue" : "bg-black/10")}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function StepDays({
  days,
  onDaysChange,
  onNext,
}: {
  days: number;
  onDaysChange: (delta: number) => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <h2 className="font-archivo text-[22px] font-extrabold leading-[1.15] tracking-[-0.5px] text-kmr-ink">
        How many days should your cab stay with you?
      </h2>
      <div className="flex items-center justify-center gap-5 py-2">
        <StepperButton label="Decrease days" onClick={() => onDaysChange(-1)}>
          −
        </StepperButton>
        <span className="min-w-[96px] text-center font-archivo text-[62px] font-black leading-none tracking-[-2px] text-kmr-blue">
          {days}
        </span>
        <StepperButton label="Increase days" onClick={() => onDaysChange(1)}>
          +
        </StepperButton>
      </div>
      <p className="text-center font-archivo text-[11.5px] font-medium leading-[1.5] text-kmr-muted-2">
        Airport to airport. Most first-timers do 4–5 days — Srinagar, Gulmarg, Pahalgam,
        done properly.
      </p>
      <Button onClick={onNext}>Continue</Button>
    </div>
  );
}

function StepTravellers({
  paxCount,
  onPaxChange,
  onNext,
}: {
  paxCount: number;
  onPaxChange: (delta: number) => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <h2 className="font-archivo text-[22px] font-extrabold leading-[1.15] tracking-[-0.5px] text-kmr-ink">
        How many of you are coming?
      </h2>
      <div className="flex items-center justify-center gap-5 py-2">
        <StepperButton label="Decrease travellers" onClick={() => onPaxChange(-1)}>
          −
        </StepperButton>
        <span className="min-w-[96px] text-center font-archivo text-[62px] font-black leading-none tracking-[-2px] text-kmr-blue">
          {paxCount}
        </span>
        <StepperButton label="Increase travellers" onClick={() => onPaxChange(1)}>
          +
        </StepperButton>
      </div>
      <p className="text-center font-archivo text-[11.5px] font-medium leading-[1.5] text-kmr-muted-2">
        We match vehicle capacity to your group automatically on the next step.
      </p>
      <Button onClick={onNext}>Continue</Button>
    </div>
  );
}

function StepVehicle({
  selected,
  paxCount,
  recommendation,
  onSelect,
  onNext,
}: {
  selected: BookingRequestDraft["vehicleType"];
  paxCount: number;
  recommendation: string | null;
  onSelect: (vehicleType: BookingRequestDraft["vehicleType"]) => void;
  onNext: () => void;
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
              <span className="flex size-11 flex-none items-center justify-center rounded-sm bg-white font-mono text-[8px] font-semibold tracking-[0.5px] text-kmr-muted-3">
                {vehicle.seatCapacity} SEATS
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
      <Button onClick={onNext}>Continue</Button>
    </div>
  );
}

function StepSummary({
  draft,
  recommendation,
  onSelectDate,
  onCustomDate,
  onEditDays,
  onEditPax,
  onEditVehicle,
  onSubmit,
}: {
  draft: BookingRequestDraft;
  recommendation: string | null;
  onSelectDate: (dateId: string) => void;
  onCustomDate: (isoDate: string) => void;
  onEditDays: () => void;
  onEditPax: () => void;
  onEditVehicle: () => void;
  onSubmit: () => void;
}) {
  const vehicleLabel =
    VEHICLE_TYPES.find((vehicle) => vehicle.code === draft.vehicleType)?.label ?? "cab";

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

      <div className="flex flex-wrap items-center gap-1.5">
        {UPCOMING_DATES.map((date) => {
          const isActive = draft.selectedDateId === date.id;
          return (
            <button
              key={date.id}
              type="button"
              onClick={() => onSelectDate(date.id)}
              className={cn(
                "whitespace-nowrap rounded-sm px-2.5 py-2 font-mono text-[9.5px] font-semibold tracking-[0.5px]",
                isActive ? "bg-kmr-blue text-white" : "bg-kmr-surface text-kmr-ink",
              )}
            >
              {date.shortLabel}
            </button>
          );
        })}
        <label
          className={cn(
            "flex items-center gap-1.5 rounded-sm px-2.5 py-1.5",
            draft.customDate ? "bg-kmr-blue text-white" : "bg-kmr-surface text-kmr-ink",
          )}
        >
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.5px]">
            OTHER
          </span>
          <input
            type="date"
            value={draft.customDate ?? ""}
            onChange={(event) => onCustomDate(event.target.value)}
            className="w-3.5 border-none bg-transparent font-mono text-[9.5px] font-semibold outline-none"
          />
        </label>
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

      <Button onClick={onSubmit}>Get my quotes</Button>
      <span className="text-center font-mono text-[9px] font-medium tracking-[1px] text-kmr-muted-3">
        QUOTES ARE MATCHED INSTANTLY AGAINST VERIFIED OPERATORS
      </span>
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
