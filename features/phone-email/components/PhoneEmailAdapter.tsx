"use client";

import { useEffect } from "react";
import type { PhoneEmailProviderMode } from "@/features/whatsapp-otp/types";

/**
 * Mirrors lib/phone-email/types.ts's PhoneEmailVerificationPayload. Kept as
 * a separate frontend-local type (rather than importing the server module
 * directly into a "use client" file) since this is the client-side half of
 * the same contract.
 */
export type PhoneEmailClientPayload =
  | { mode: "user_json_url"; user_json_url: string }
  | { mode: "user_info"; user_info: unknown };

interface PhoneEmailAdapterProps {
  onVerified: (payload: PhoneEmailClientPayload) => void;
  onUnavailable?: (message: string) => void;
}

/**
 * Single source of truth for whether/which Phone.Email frontend integration
 * is configured (Plan §4/§7). Exported so features/booking-request can
 * reflect the resolved mode in OtpState without duplicating env reads.
 */
export function getPhoneEmailProviderMode(): PhoneEmailProviderMode {
  const enabled = process.env.NEXT_PUBLIC_PHONE_EMAIL_ENABLED === "true";
  const clientId = process.env.NEXT_PUBLIC_PHONE_EMAIL_CLIENT_ID;
  const rawMode = process.env.NEXT_PUBLIC_PHONE_EMAIL_PROVIDER_MODE;

  if (!enabled || !clientId) return "unconfigured";
  if (rawMode === "generated_button" || rawMode === "react_client") return rawMode;
  return "unconfigured";
}

/**
 * The only component in this codebase allowed to know about Phone.Email's
 * frontend SDK/widget details (Plan §7). Phone.Email's docs
 * (https://www.phone.email/docs-sign-in-with-phone) describe at least two
 * integration shapes — a generated-button flow returning a `user_json_url`,
 * and a React `phone-email-auth` component returning `userInfo` — and the
 * TL has not yet supplied the exact dashboard-generated script/component
 * configuration for either. Rather than guess at one, this renders a
 * controlled boundary state until that configuration lands.
 *
 * `onVerified` is the single seam the rest of the app depends on: once a
 * concrete provider is wired in here, this component translates whatever
 * that provider's callback shape is into one of the two provider-neutral
 * payloads the backend already understands
 * (app/api/otp/phone-email/verify/route.ts) — it never forwards a raw
 * phone number read from the browser.
 */
const UNAVAILABLE_MESSAGE =
  "Backup verification is being configured. Please try WhatsApp again shortly.";

export function PhoneEmailAdapter({ onVerified, onUnavailable }: PhoneEmailAdapterProps) {
  const mode = getPhoneEmailProviderMode();

  // Both branches currently resolve to the same controlled boundary state:
  // "unconfigured" means required public config is missing; the other
  // modes confirm config is present but the concrete generated-button
  // script / React SDK wiring is still pending TL-provided dashboard
  // configuration (see file header). `onVerified` stays unused until one
  // of those two branches is implemented here.
  void onVerified;
  useEffect(() => {
    onUnavailable?.(UNAVAILABLE_MESSAGE);
  }, [mode, onUnavailable]);

  return <PhoneEmailUnavailableNotice message={UNAVAILABLE_MESSAGE} />;
}

function PhoneEmailUnavailableNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-sm bg-kmr-surface px-4 py-5 text-center"
    >
      <p className="font-archivo text-[12.5px] font-medium leading-[1.55] text-kmr-muted-1">
        {message}
      </p>
    </div>
  );
}
