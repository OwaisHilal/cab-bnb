"use client";

import { cn } from "@/lib/utils/cn";

type NavTab = "home" | "booking" | "profile";

interface BottomNavProps {
  active: NavTab;
  hasActiveBooking: boolean;
  onNavigate: (tab: NavTab) => void;
}

const TAB_LABEL: Record<NavTab, string> = {
  home: "HOME",
  booking: "BOOKING",
  profile: "PROFILE",
};

export function BottomNav({ active, hasActiveBooking, onNavigate }: BottomNavProps) {
  const tabs: NavTab[] = ["home", "booking", "profile"];

  return (
    <div className="absolute inset-x-0 bottom-0 flex border-t border-black/10 bg-white px-0 pb-3.5 pt-1.5">
      {tabs.map((tab) => {
        const isActive = active === tab;
        const color = isActive ? "var(--kmr-blue)" : "var(--kmr-muted-3)";
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onNavigate(tab)}
            aria-label={TAB_LABEL[tab]}
            aria-current={isActive ? "page" : undefined}
            className="flex flex-1 flex-col items-center gap-1 bg-transparent py-1.5"
          >
            <span className="relative inline-flex">
              <NavIcon tab={tab} color={color} />
              {tab === "booking" && hasActiveBooking && (
                <span className="absolute -right-[5px] -top-[2px] size-[6px] rounded-full bg-kmr-orange" />
              )}
            </span>
            <span
              className={cn("font-mono text-[8.5px] font-semibold tracking-[1px]")}
              style={{ color }}
            >
              {TAB_LABEL[tab]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NavIcon({ tab, color }: { tab: NavTab; color: string }) {
  if (tab === "home") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8Z"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (tab === "booking") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 16v-3l2-5h12l2 5v3h-2.5m-11 0H4m2.5 0a1.5 1.5 0 1 0 3 0m5 0a1.5 1.5 0 1 0 3 0m-8 0h5"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke={color} strokeWidth="1.8" />
      <path
        d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
