import { TopBar } from "@/components/ui/TopBar";
import { TRIP_PRESETS } from "@/features/booking-request/constants";

const VERIFIED_OPERATORS = ["VALE CABS", "himways", "GK TOURS", "SNOWLINE", "ZOJI GO"];

interface HomeHeroProps {
  onOpenRequest: () => void;
  onApplyPreset: (days: number) => void;
}

export function HomeHero({ onOpenRequest, onApplyPreset }: HomeHeroProps) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-[30px] pb-6 pt-[30px]">
      <TopBar />

      <h1 className="mt-2 font-archivo text-[40px] font-extrabold leading-[1.05] tracking-[-1.2px] animate-kmr-reveal">
        <span className="block text-kmr-ink">Cabs in Kashmir,</span>
        <span className="block text-kmr-blue">sorted. All of it.</span>
      </h1>

      <p className="font-archivo text-sm font-medium leading-[1.55] text-kmr-muted-1">
        One request, matched quotes from every verified operator on your route —
        sent straight to your WhatsApp.
      </p>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
          QUOTES FROM VERIFIED OPERATORS
        </span>
        <div className="flex items-center gap-4 overflow-x-auto pb-0.5">
          {VERIFIED_OPERATORS.map((name, index) => (
            <div key={name} className="flex flex-none items-center gap-4">
              <span className="whitespace-nowrap font-archivo text-xs font-bold tracking-wide text-kmr-muted-1">
                {name}
              </span>
              {index < VERIFIED_OPERATORS.length - 1 && (
                <span className="size-1 flex-none rounded-full bg-kmr-orange" />
              )}
            </div>
          ))}
        </div>
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
