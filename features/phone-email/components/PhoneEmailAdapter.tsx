"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhoneEmailProviderMode } from "@/features/whatsapp-otp/types";

/**
 * Mirrors lib/phone-email/types.ts's PhoneEmailVerificationPayload. Kept as
 * a separate frontend-local type (rather than importing the server module
 * directly into a "use client" file) since this is the client-side half of
 * the same contract.
 */
export type PhoneEmailClientPayload =
  | { mode: "access_token"; access_token: string }
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
  if (rawMode === "access_token" || rawMode === "generated_button" || rawMode === "react_client") return rawMode;
  return "unconfigured";
}

const UNAVAILABLE_MESSAGE =
  "Backup verification is being configured. Please try WhatsApp again shortly.";
const POPUP_BLOCKED_MESSAGE =
  "Your browser blocked the verification pop-up. Please allow pop-ups for this site and try again.";
const CALLBACK_PATH = "/phone-email/callback";
const CALLBACK_MESSAGE_SOURCE = "phone-email-callback";
const POPUP_FEATURES = "width=420,height=640,noopener=no,noreferrer=no";

interface PhoneEmailCallbackMessage {
  source: string;
  access_token?: string;
  error?: string;
}

function isPhoneEmailCallbackMessage(data: unknown): data is PhoneEmailCallbackMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === CALLBACK_MESSAGE_SOURCE
  );
}

/**
 * The only component in this codebase allowed to know about Phone.Email's
 * frontend integration details (Plan §7). Implements the docs-backed
 * "access_token" popup flow that matches this project's CLIENT_ID + API Key
 * credentials (Plan §2 audit): opens Phone.Email's hosted auth page in a
 * popup, receives `access_token` via a same-origin postMessage relayed by
 * app/phone-email/callback, and hands it to the backend to exchange +
 * validate. The `generated_button`/`react_client` modes stay controlled
 * placeholders — their exact dashboard-generated wiring is still unconfirmed.
 *
 * `onVerified` is the single seam the rest of the app depends on: this
 * component never forwards a raw phone number read from the browser, only
 * Phone.Email's own provider proof.
 */
export function PhoneEmailAdapter({ onVerified, onUnavailable }: PhoneEmailAdapterProps) {
  const mode = getPhoneEmailProviderMode();
  const [isWaitingForPopup, setIsWaitingForPopup] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);

  const closePopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
  }, []);

  useEffect(() => {
    if (mode !== "access_token") return;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!isPhoneEmailCallbackMessage(event.data)) return;

      setIsWaitingForPopup(false);
      closePopup();

      if (event.data.access_token) {
        setLocalError(null);
        onVerifiedRef.current({ mode: "access_token", access_token: event.data.access_token });
        return;
      }

      setLocalError(event.data.error || "Phone.Email verification did not complete. Please try again.");
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [mode, closePopup]);

  useEffect(() => {
    return () => closePopup();
  }, [closePopup]);

  useEffect(() => {
    if (mode === "generated_button" || mode === "react_client" || mode === "unconfigured") {
      onUnavailable?.(UNAVAILABLE_MESSAGE);
    }
  }, [mode, onUnavailable]);

  const handleSignIn = useCallback(() => {
    const clientId = process.env.NEXT_PUBLIC_PHONE_EMAIL_CLIENT_ID;
    if (!clientId) {
      setLocalError(UNAVAILABLE_MESSAGE);
      return;
    }

    setLocalError(null);
    const redirectUrl = `${window.location.origin}${CALLBACK_PATH}`;
    const authUrl = `https://www.phone.email/auth/log-in?client_id=${encodeURIComponent(clientId)}&redirect_url=${encodeURIComponent(redirectUrl)}`;

    const popup = window.open(authUrl, "phoneEmailLogin", POPUP_FEATURES);
    if (!popup) {
      setLocalError(POPUP_BLOCKED_MESSAGE);
      return;
    }

    popupRef.current = popup;
    setIsWaitingForPopup(true);
  }, []);

  if (mode !== "access_token") {
    return <PhoneEmailUnavailableNotice message={UNAVAILABLE_MESSAGE} />;
  }

  return (
    <div className="flex flex-col items-center gap-2.5">
      <button
        type="button"
        onClick={handleSignIn}
        disabled={isWaitingForPopup}
        aria-label="Sign in with Phone.Email to verify your number"
        className="flex w-full items-center justify-center gap-2.5 rounded-sm bg-kmr-blue px-4 py-3.5 font-archivo text-sm font-bold text-white transition-opacity disabled:opacity-60"
        style={{ height: 52 }}
      >
        <PhoneEmailIcon />
        {isWaitingForPopup ? "Waiting for verification…" : "Sign In with Phone"}
      </button>
      {localError && (
        <span
          role="status"
          className="text-center font-mono text-[10px] font-semibold text-kmr-orange"
        >
          {localError}
        </span>
      )}
    </div>
  );
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

function PhoneEmailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" stroke="#fff" strokeWidth="1.8" />
      <line x1="6.5" y1="17.5" x2="17.5" y2="17.5" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="19.3" r="0.9" fill="#fff" />
    </svg>
  );
}
