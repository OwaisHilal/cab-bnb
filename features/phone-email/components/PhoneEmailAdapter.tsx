"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhoneEmailProviderMode } from "@/features/whatsapp-otp/types";

interface PhoneEmailAdapterProps {
  /**
   * Called synchronously right before the Phone.Email popup opens — the
   * caller's last chance to persist whatever it needs into sessionStorage
   * (session/trip request id, draft) so
   * features/booking-request/hooks/useBookingFlow.ts can resume once the
   * main tab is redirected to /phone-email/callback. Phone.Email's own
   * hosted popup does that redirect via `window.opener.location` once the
   * user finishes verifying — not this component — so persisting has to
   * happen up front, before we lose control of when the tab navigates.
   */
  onBeforeRedirect?: () => void;
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
const POPUP_BLOCKED_MESSAGE = "Please allow pop-ups for this site, then try again.";
const CALLBACK_PATH = "/phone-email/callback";
const POPUP_NAME = "peLoginWindow";
const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 560;
const POPUP_POLL_MS = 500;

function buildPopupFeatures(): string {
  const top = Math.max(0, Math.round((window.screen.height - POPUP_HEIGHT) / 2));
  const left = Math.max(0, Math.round((window.screen.width - POPUP_WIDTH) / 2));
  return `toolbar=0,scrollbars=0,location=0,statusbar=0,menubar=0,resizable=0,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},top=${top},left=${left}`;
}

/**
 * The only component in this codebase allowed to know about Phone.Email's
 * frontend integration details (Plan §7). Implements the docs-backed
 * "access_token" flow that matches this project's CLIENT_ID + API Key
 * credentials (Plan §2 audit), following Phone.Email's own reference
 * integration exactly: a named popup that *they* redirect via
 * `window.opener.location` once the user verifies, then close themselves.
 * That only works because next.config.ts sends
 * `Cross-Origin-Opener-Policy: same-origin-allow-popups` on every response
 * — without it, Chrome's default heuristics sever `window.opener` partway
 * through Phone.Email's own cross-origin navigation chain, which is what
 * broke both this and a since-reverted full-redirect attempt. This
 * component never calls `popup.close()` itself (that's Phone.Email's job,
 * and is exactly the operation the browser restricts to the window's own
 * script) — it only reads `popup.closed`, which is always safe cross-origin,
 * to reset the button if the user abandons the popup. The
 * `generated_button`/`react_client` modes stay controlled placeholders —
 * their exact dashboard-generated wiring is still unconfirmed.
 */
export function PhoneEmailAdapter({ onBeforeRedirect, onUnavailable }: PhoneEmailAdapterProps) {
  const mode = getPhoneEmailProviderMode();
  const [localError, setLocalError] = useState<string | null>(null);
  const [isAwaitingPopup, setIsAwaitingPopup] = useState(false);
  const popupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (mode === "generated_button" || mode === "react_client" || mode === "unconfigured") {
      onUnavailable?.(UNAVAILABLE_MESSAGE);
    }
  }, [mode, onUnavailable]);

  useEffect(() => {
    return () => {
      if (popupPollRef.current) clearInterval(popupPollRef.current);
    };
  }, []);

  const handleSignIn = useCallback(() => {
    const clientId = process.env.NEXT_PUBLIC_PHONE_EMAIL_CLIENT_ID;
    if (!clientId) {
      setLocalError(UNAVAILABLE_MESSAGE);
      return;
    }

    setLocalError(null);
    onBeforeRedirect?.();

    const redirectUrl = `${window.location.origin}${CALLBACK_PATH}`;
    const authUrl = `https://www.phone.email/auth/log-in?client_id=${encodeURIComponent(clientId)}&redirect_url=${encodeURIComponent(redirectUrl)}`;

    const popup = window.open(authUrl, POPUP_NAME, buildPopupFeatures());
    if (!popup) {
      setLocalError(POPUP_BLOCKED_MESSAGE);
      return;
    }

    setIsAwaitingPopup(true);
    if (popupPollRef.current) clearInterval(popupPollRef.current);
    popupPollRef.current = setInterval(() => {
      if (popup.closed) {
        if (popupPollRef.current) clearInterval(popupPollRef.current);
        popupPollRef.current = null;
        setIsAwaitingPopup(false);
      }
    }, POPUP_POLL_MS);
  }, [onBeforeRedirect]);

  if (mode !== "access_token") {
    return <PhoneEmailUnavailableNotice message={UNAVAILABLE_MESSAGE} />;
  }

  return (
    <div className="flex flex-col items-center gap-2.5">
      <button
        type="button"
        onClick={handleSignIn}
        disabled={isAwaitingPopup}
        aria-label="Sign in with Phone.Email to verify your number"
        className="flex w-full items-center justify-center gap-2.5 rounded-sm bg-kmr-blue px-4 py-3.5 font-archivo text-sm font-bold text-white transition-opacity disabled:opacity-60"
        style={{ height: 52 }}
      >
        <PhoneEmailIcon />
        {isAwaitingPopup ? "Waiting for verification…" : "Sign In with Phone"}
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
