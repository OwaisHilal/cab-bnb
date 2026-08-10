import { TopBar } from "@/components/ui/TopBar";
import type { ProfileSummary } from "@/features/profile/types";

interface ProfileScreenProps {
  profile: ProfileSummary;
  onOpenBooking: () => void;
}

export function ProfileScreen({ profile, onOpenBooking }: ProfileScreenProps) {
  return (
    <div className="flex-1 overflow-y-auto p-[30px] pb-[90px] pt-[30px] animate-kmr-fade">
      <TopBar />

      <div className="mt-4 flex items-center gap-3.5">
        <span className="flex size-[54px] flex-none items-center justify-center rounded-full bg-kmr-blue font-archivo text-[22px] font-extrabold text-white">
          T
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="font-archivo text-xl font-extrabold tracking-[-0.4px] text-kmr-ink">
            Traveller
          </span>
          <span className="font-mono text-[11px] font-medium tracking-[0.5px] text-kmr-muted-2">
            {profile.phoneDisplay}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {profile.hasActiveBooking && profile.activeBookingLabel && (
          <button
            type="button"
            onClick={onOpenBooking}
            className="flex flex-col gap-1 rounded-sm bg-kmr-surface p-3.5 text-left"
          >
            <span className="font-mono text-[8.5px] font-semibold tracking-[1.5px] text-kmr-orange">
              ACTIVE BOOKING
            </span>
            <span className="font-archivo text-sm font-bold tracking-[-0.2px] text-kmr-ink">
              {profile.activeBookingLabel}
            </span>
          </button>
        )}
        <div className="flex items-center justify-between rounded-sm bg-kmr-surface p-3.5">
          <span className="font-archivo text-sm font-bold tracking-[-0.2px] text-kmr-ink">
            WhatsApp updates
          </span>
          <span className="font-mono text-[8.5px] font-semibold tracking-[1px] text-kmr-green-dark">
            ON
          </span>
        </div>
        <button
          type="button"
          className="flex bg-transparent p-3.5 text-left"
        >
          <span className="font-archivo text-[13px] font-bold text-kmr-orange">
            Sign out
          </span>
        </button>
      </div>
    </div>
  );
}
