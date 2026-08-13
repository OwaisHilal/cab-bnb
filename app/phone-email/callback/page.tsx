"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getOrCreateClientSessionId } from "@/lib/utils/clientSession";
import {
  readAndClearPendingPhoneEmailResume,
  writeVerifiedPhoneEmailResume,
} from "@/lib/phone-email/resumeState";

type CallbackStatus = "verifying" | "error";

/**
 * Reached because Phone.Email's own hosted popup redirects our *main* tab
 * here (`window.opener.location = ...`) once the user finishes verifying,
 * then closes itself — see
 * features/phone-email/components/PhoneEmailAdapter.tsx and the
 * `Cross-Origin-Opener-Policy: same-origin-allow-popups` header in
 * next.config.ts that keeps that opener handoff working. Either way this
 * page loads as a normal top-level navigation on our own origin with
 * `access_token` in the query string, which is all this page cares about.
 * It finishes verification server-side, hands the result back to the app
 * via sessionStorage (lib/phone-email/resumeState.ts), and returns to "/"
 * with a normal, always-working client-side navigation.
 */
function PhoneEmailCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>("verifying");
  // sessionStorage.removeItem + the verify fetch below aren't idempotent
  // together — React (Strict Mode, dev only) invokes this effect twice on
  // mount, and a second run would find the pending flag already consumed
  // and surface a spurious error. This ref ensures run() only ever
  // actually executes once per mount.
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    let cancelled = false;

    async function run() {
      const accessToken = searchParams.get("access_token");
      const pending = readAndClearPendingPhoneEmailResume();

      if (!accessToken || !pending) {
        if (!cancelled) setStatus("error");
        return;
      }

      try {
        const response = await fetch("/api/otp/phone-email/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: getOrCreateClientSessionId(),
            trip_request_id: pending.tripRequestId,
            provider_payload: { mode: "access_token", access_token: accessToken },
          }),
        });

        if (!response.ok) {
          if (!cancelled) setStatus("error");
          return;
        }

        writeVerifiedPhoneEmailResume(pending);
        router.replace("/");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-kmr-backdrop px-6 text-center">
      <p className="font-archivo text-sm font-medium text-kmr-muted-1">
        {status === "error"
          ? "We couldn't verify your number. Please return and try again."
          : "Verifying your number…"}
      </p>
      {status === "error" && (
        <button
          type="button"
          onClick={() => router.replace("/")}
          className="rounded-sm bg-kmr-blue px-5 py-2.5 font-archivo text-sm font-bold text-white"
        >
          Return to app
        </button>
      )}
    </div>
  );
}

export default function PhoneEmailCallbackPage() {
  return (
    <Suspense fallback={null}>
      <PhoneEmailCallbackContent />
    </Suspense>
  );
}
