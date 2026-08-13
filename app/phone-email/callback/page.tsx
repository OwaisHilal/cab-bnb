"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

const CALLBACK_MESSAGE_SOURCE = "phone-email-callback";

/**
 * Phone.Email's auth popup (opened by features/phone-email/components/
 * PhoneEmailAdapter.tsx) redirects here with `access_token` in the query
 * string once the user completes verification. This page never displays or
 * stores that token — it only relays it to the window that opened the
 * popup via a same-origin postMessage, then closes itself. The opener
 * validates `event.origin` before trusting the message.
 */
function PhoneEmailCallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const accessToken = searchParams.get("access_token");
    const message = accessToken
      ? { source: CALLBACK_MESSAGE_SOURCE, access_token: accessToken }
      : {
          source: CALLBACK_MESSAGE_SOURCE,
          error: "Phone.Email did not return a verification token.",
        };

    if (window.opener) {
      window.opener.postMessage(message, window.location.origin);
    }
    window.close();
  }, [searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-kmr-backdrop px-6 text-center">
      <p className="font-archivo text-sm font-medium text-kmr-muted-1">
        Completing verification… you can close this window.
      </p>
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
