import { TopBar } from "@/components/ui/TopBar";
import { RouteOrbitCanvas } from "@/features/booking-request/components/RouteOrbitCanvas";
import { TRIP_PRESETS } from "@/features/booking-request/constants";

const VERIFIED_OPERATORS = ["VALE CABS", "himways", "GK TOURS", "SNOWLINE", "ZOJI GO"];

function VerifiedOperatorsMarquee() {
  const renderOperatorItems = (keyPrefix: string) =>
    VERIFIED_OPERATORS.map((name) => (
      <div key={`${keyPrefix}-${name}`} className="flex flex-none items-center gap-4">
        <span className="whitespace-nowrap font-archivo text-xs font-bold tracking-wide text-kmr-muted-1">
          {name}
        </span>
        <span className="size-1 flex-none rounded-full bg-kmr-orange" />
      </div>
    ));

  return (
    <div className="overflow-hidden" aria-label="Verified operators">
      <div className="flex w-max animate-kmr-marquee">
        <div className="flex flex-none items-center gap-4 pr-4">{renderOperatorItems("a")}</div>
        <div className="flex flex-none items-center gap-4 pr-4" aria-hidden="true">
          {renderOperatorItems("b")}
        </div>
      </div>
    </div>
  );
}

interface HomeHeroProps {
  onOpenRequest: () => void;
  onApplyPreset: (days: number) => void;
}

export function HomeHero({ onOpenRequest, onApplyPreset }: HomeHeroProps) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-[30px] pb-[90px] pt-[30px]">
      <TopBar />

      <h1 className="mt-2 font-archivo text-[40px] font-extrabold leading-[1.05] tracking-[-1.2px] animate-kmr-reveal">
        <span className="block text-kmr-ink">Cabs in Kashmir,</span>
        <span className="block text-kmr-blue">sorted. All of it.</span>
      </h1>

      <p className="font-archivo text-sm font-medium leading-[1.55] text-kmr-muted-1">
        One request, matched quotes from every verified operator on your route —
        sent straight to your WhatsApp.
      </p>

      <div className="relative -mx-[30px] h-[100px] flex-none">
        <RouteOrbitCanvas />
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[60px] bg-gradient-to-r from-white from-[12%] to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-[60px] bg-gradient-to-l from-white from-[12%] to-transparent"
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          QUOTES FROM VERIFIED OPERATORS
        </span>
        <VerifiedOperatorsMarquee />
      </div>

      <button
        type="button"
        onClick={onOpenRequest}
        className="flex w-full items-center justify-between gap-3 rounded-sm bg-kmr-blue px-5 py-5 text-left transition-colors hover:bg-kmr-blue-dark"
      >
        <span className="flex flex-col gap-1">
          <span className="font-archivo text-[19px] font-extrabold tracking-[-0.4px] text-white">
            Add cabs to your trip
          </span>
          <span className="font-mono text-[9.5px] font-medium tracking-[1px] text-white/60">
            DAYS · TRAVELLERS · CAB — 3 QUICK TAPS
          </span>
        </span>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" className="flex-none">
          <path
            d="M5 19 L17.5 6.5 M8 6 H18 V16"
            stroke="#fff"
            strokeWidth="2.6"
            strokeLinecap="square"
          />
        </svg>
      </button>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          TRIPS TRAVELLERS KEEP TAKING
        </span>
        <div className="grid grid-cols-2 gap-2.5">
          {TRIP_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onApplyPreset(preset.days);
                onOpenRequest();
              }}
              className="flex flex-col gap-2 rounded-sm bg-kmr-surface p-3.5 text-left transition-colors hover:bg-kmr-surface-hover"
            >
              <span className="font-mono text-[8.5px] font-semibold tracking-[0.5px] text-kmr-muted-2">
                {preset.days} DAYS
              </span>
              <span className="font-archivo text-[14.5px] font-bold leading-tight tracking-[-0.2px] text-kmr-ink">
                {preset.name}
              </span>
              <span className="font-mono text-[9.5px] font-medium text-kmr-muted-1">
                {preset.meta}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
