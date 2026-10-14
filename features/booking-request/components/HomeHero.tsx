import type { ReactNode } from "react";
import Image from "next/image";
import { TopBar } from "@/components/ui/TopBar";
import { RouteOrbitCanvas } from "@/features/booking-request/components/RouteOrbitCanvas";

interface VerifiedOperator {
  name: string;
  logo: string;
}

const VERIFIED_OPERATORS: VerifiedOperator[] = [
  { name: "NOVO CABS", logo: "/cab-logos/novo.png" },
  { name: "OLA CABS", logo: "/cab-logos/ola.jpeg" },
  { name: "AALA CABS", logo: "/cab-logos/aala.jpeg" },
  { name: "UBER", logo: "/cab-logos/uber.jpg" },
];

interface TrustBadge {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
}

const TRUST_BADGES: TrustBadge[] = [
  {
    id: "verified-operators",
    label: "Verified operators only",
    description: "Every quote comes from an operator we've vetted",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3 20 6.5v5c0 5-3.5 8-8 9.5-4.5-1.5-8-4.5-8-9.5v-5L12 3Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M8.5 12.3 11 14.8l4.5-5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "confirm-on-whatsapp",
    label: "Confirm on WhatsApp",
    description: "No new app — payment and driver details land in your chat",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3a8.5 8.5 0 0 0-7.3 12.9L4 21l5.3-.7A8.5 8.5 0 1 0 12 3Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M8.7 10.3c0 3 2.5 5.5 5.5 5.5.4 0 .9-.5.9-1v-.7c0-.3-.2-.5-.5-.6l-1.4-.5c-.3-.1-.5 0-.7.2l-.3.4a4.3 4.3 0 0 1-2.3-2.3l.4-.3c.2-.2.3-.4.2-.7l-.5-1.4c-.1-.3-.3-.5-.6-.5h-.7c-.5 0-1 .5-1 .9Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "no-app-download",
    label: "No app to download",
    description: "Everything runs in the browser, start to finish",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10.5 18h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 9 2 11l2 2M20 9l2 2-2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

function TrustBadges() {
  return (
    <div className="flex flex-col gap-3">
      {TRUST_BADGES.map((badge) => (
        <div key={badge.id} className="flex items-start gap-3">
          <span className="flex size-9 flex-none items-center justify-center rounded-full bg-kmr-blue/10 text-kmr-blue">
            {badge.icon}
          </span>
          <div className="flex flex-col gap-0.5 pt-0.5">
            <span className="font-archivo text-[14px] font-bold leading-tight tracking-[-0.2px] text-kmr-ink">
              {badge.label}
            </span>
            <span className="font-archivo text-[12px] font-medium leading-[1.4] text-kmr-muted-1">
              {badge.description}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function VerifiedOperatorsMarquee() {
  const renderOperatorItems = (keyPrefix: string) =>
    VERIFIED_OPERATORS.map(({ name, logo }) => (
      <div key={`${keyPrefix}-${name}`} className="flex flex-none items-center gap-6">
        <span className="relative size-16 flex-none overflow-hidden rounded-full bg-white ring-1 ring-black/5">
          <Image
            src={logo}
            alt={`${name} logo`}
            fill
            sizes="64px"
            className="object-cover"
          />
        </span>
        <span className="size-1 flex-none rounded-full bg-kmr-orange" />
      </div>
    ));

  return (
    <div className="overflow-hidden" aria-label="Verified operators">
      <div className="flex w-max animate-kmr-marquee">
        <div className="flex flex-none items-center gap-6 pr-6">{renderOperatorItems("a")}</div>
        <div className="flex flex-none items-center gap-6 pr-6" aria-hidden="true">
          {renderOperatorItems("b")}
        </div>
      </div>
    </div>
  );
}

interface HomeHeroProps {
  hasBooking: boolean;
  onOpenRequest: () => void;
  onContinue: () => void;
  onViewBooking: () => void;
}

export function HomeHero({
  hasBooking,
  onOpenRequest,
  onContinue,
  onViewBooking,
}: HomeHeroProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-[30px] pb-4 pt-[30px]">
        <TopBar />

        <h1 className="mt-2 font-archivo text-[42px] font-extrabold leading-[1.05] tracking-[-1.3px] animate-kmr-reveal">
          <span className="block text-kmr-ink">Cabs in Kashmir,</span>
          <span className="block text-kmr-blue">sorted. All of it.</span>
        </h1>

        <p className="font-archivo text-xs font-medium leading-[1.5] text-kmr-muted-1">
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

        <div className="flex flex-col gap-3">
          <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
            WHY BOOK WITH US
          </span>
          <TrustBadges />
        </div>
      </div>

      <div className="flex flex-none flex-col gap-2 border-t border-black/5 bg-white px-[30px] pb-[90px] pt-4">
        {hasBooking ? (
          <div className="flex flex-col gap-3 rounded-sm bg-kmr-surface p-4">
            <p className="font-archivo text-sm font-bold text-kmr-ink">Only 1 booking is allowed for now.</p>
            <button
              type="button"
              aria-label="View current booking"
              onClick={onViewBooking}
              className="flex w-full items-center justify-center rounded-sm bg-kmr-blue px-4 py-3 text-center font-archivo text-sm font-bold text-white"
            >
              View current booking
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenRequest}
            className="relative flex w-full items-center justify-center rounded-sm bg-kmr-blue px-5 py-5 transition-colors hover:bg-kmr-blue-dark"
          >
            <span className="text-center font-archivo text-[19px] font-extrabold tracking-[-0.4px] text-white">
              Add cabs to your trip
            </span>
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              className="absolute right-5 top-1/2 flex-none -translate-y-1/2"
              aria-hidden="true"
            >
              <path
                d="M5 19 L17.5 6.5 M8 6 H18 V16"
                stroke="#fff"
                strokeWidth="2.6"
                strokeLinecap="square"
              />
            </svg>
          </button>
        )}

        <button
          type="button"
          onClick={onContinue}
          aria-label="Already booked? Check your trip"
          className="mx-auto inline-flex min-h-[44px] items-center justify-center self-center px-1 py-2 font-archivo text-sm font-bold text-kmr-muted-1 underline transition-colors hover:text-kmr-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kmr-blue"
        >
          Already booked? Check your trip
        </button>
      </div>
    </div>
  );
}
