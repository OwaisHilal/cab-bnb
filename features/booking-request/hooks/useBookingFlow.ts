"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  MAX_PAX_COUNT,
  MAX_TRIP_DAYS,
  MIN_PAX_COUNT,
  MIN_TRIP_DAYS,
  SEDAN_SEAT_CAPACITY,
  VEHICLE_TYPE_IDS_BY_CODE,
  VEHICLE_TYPES,
  DEMO_VENDOR_NAMES,
} from "@/features/booking-request/constants";
import { resolveTripStartDate } from "@/features/booking-request/resolveTripStartDate";
import type {
  BookingRequestDraft,
  BookingRequestStep,
  VehicleTypeCode,
} from "@/features/booking-request/types";
import { OTP_SHEET_REVEAL_DELAY_MS, QUOTE_REVEAL_DELAY_MS } from "@/features/quote-dispatch/constants";
import type { DispatchVendorRow } from "@/features/quote-dispatch/types";
import { computeVerifiedTransitionDelayMs } from "@/features/quote-dispatch/transitionTiming";
import { OTP_CODE_LENGTH } from "@/features/whatsapp-otp/types";
import type { OtpDeliveryChannel, OtpState } from "@/features/whatsapp-otp/types";
import type { BookingSummaryUi } from "@/features/booking-status/types";
import { getOrCreateClientSessionId, resetClientSessionId } from "@/lib/utils/clientSession";
import { toIndianE164, isValidIndianMobile, sanitizeIndianPhoneInput, phoneLast4 } from "@/lib/utils/phone";
import { getPhoneEmailProviderMode } from "@/features/phone-email/components/PhoneEmailAdapter";
import {
  clearPhoneEmailResumeState,
  clearVerifiedPhoneEmailResume,
  peekVerifiedPhoneEmailResume,
  writePendingPhoneEmailResume,
} from "@/lib/phone-email/resumeState";
import type { PhoneEmailResumePayload } from "@/lib/phone-email/resumeState";
import { clearCachedGuestTrip, fetchGuestTrip } from "@/features/guest-trip/guestTripClient";

type PrimaryScreen = "home" | "booking" | "profile";
type Overlay = "none" | "sheet" | "otp" | "mock_chat";

interface TripRequestCreateResponse {
  trip_request_id: string;
  matched_vendor_count: number;
  existing?: boolean;
  recommendation: { recommended_vehicle_type_id: number; reason: string | null } | null;
}

const ONE_BOOKING_NOTICE = "Only 1 booking is allowed for now.";

// How long the "You're in." success state holds at minimum before handing
// off to the booking screen — see computeVerifiedTransitionDelayMs, which
// extends this when the matching animation is still running.
const VERIFIED_SUCCESS_BEAT_MS = 900;

function createDraft(): BookingRequestDraft {
  return {
    days: 5,
    paxCount: 2,
    vehicleType: "sedan",
    selectedDateId: null,
    customDate: null,
  };
}

function createDispatchRows(vendorCount: number): DispatchVendorRow[] {
  return Array.from({ length: vendorCount }, (_, index) => ({
    id: `vendor-${index}`,
    name: DEMO_VENDOR_NAMES[index] ?? `Verified operator ${index + 1}`,
    status: "pending" as const,
  }));
}

function createOtpState(): OtpState {
  return {
    step: "phone",
    phone: "",
    code: "",
    deliveryChannel: null,
    demoOtpCode: null,
    phoneEmailMode: getPhoneEmailProviderMode(),
    isSubmitting: false,
    error: null,
  };
}

function buildRecommendation(days: number, pax: number, vehicleType: VehicleTypeCode) {
  if (vehicleType !== "sedan" || pax <= SEDAN_SEAT_CAPACITY) return null;
  const suv = VEHICLE_TYPES.find((vehicle) => vehicle.code === "suv");
  if (!suv || pax > suv.seatCapacity) return null;
  const sedanCount = Math.ceil(pax / SEDAN_SEAT_CAPACITY);
  return `${sedanCount} sedans won't seat ${pax} comfortably for ${days} days — matched vendors include SUV quotes too.`;
}

function buildRequestRef(tripRequestId: string | null): string {
  return tripRequestId ? `REQ-${tripRequestId.slice(0, 8).toUpperCase()}` : "REQUEST PENDING";
}

function bookingSummaryFromPhoneEmailResume(payload: PhoneEmailResumePayload): BookingSummaryUi {
  return {
    bookingRef: buildRequestRef(payload.tripRequestId),
    summaryLabel: `${payload.days} days · ${payload.paxCount} travellers · ${payload.vehicleType.toUpperCase()}`,
    quotes: [],
    selectedQuoteId: null,
    isAwaitingQuotes: true,
  };
}

export function useBookingFlow() {
  const [screen, setScreen] = useState<PrimaryScreen>("home");
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [sheetStep, setSheetStep] = useState<BookingRequestStep>(0);
  const [draft, setDraft] = useState<BookingRequestDraft>(createDraft);
  const [dispatchRows, setDispatchRows] = useState<DispatchVendorRow[]>([]);
  // Whether the "Matching your trip." screen should render. Decoupled from
  // `overlay` so it can keep showing underneath the OTP sheet once that
  // rises on top of it (simultaneous matching + verify reveal) instead of
  // the two being mutually exclusive.
  const [isDispatchActive, setIsDispatchActive] = useState(false);
  const [otp, setOtp] = useState<OtpState>(createOtpState);
  const [isVerified, setIsVerified] = useState(false);
  const [booking, setBooking] = useState<BookingSummaryUi | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [tripRequestId, setTripRequestId] = useState<string | null>(null);
  const [dispatchDelayMs, setDispatchDelayMs] = useState(QUOTE_REVEAL_DELAY_MS);
  const [isDemoFlow, setIsDemoFlow] = useState(false);
  const [resumeMode, setResumeMode] = useState(false);
  const [tripNotice, setTripNotice] = useState<string | null>(null);
  // Client-only sessionStorage reads must not run in useState initializers:
  // the server HTML is rendered with the defaults above, and the client's
  // first hydration render must match exactly or React warns (e.g. HomeHero's
  // hasBooking footer flipping when tripRequestId was seeded only on client).
  const [isClientBootstrapped, setIsClientBootstrapped] = useState(false);
  const [phoneEmailResumeApplied, setPhoneEmailResumeApplied] = useState(false);
  // Durable login identity from the 7-day session cookie (Phone Session
  // Login plan) — distinct from sessionId above, which stays the per-tab
  // device id. null until GET /api/auth/session confirms a valid cookie.
  const [customerIdentity, setCustomerIdentity] = useState<{ touristId: string; phoneE164: string } | null>(null);

  const dispatchTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dispatchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otpRevealTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifiedTransitionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wall-clock timestamp the matching animation started, so a later
  // successful verification can tell how much of it is still left to play
  // out (computeVerifiedTransitionDelayMs). Null when no matching animation
  // is in flight (e.g. the "Already booked?" resume flow).
  const dispatchStartedAtRef = useRef<number | null>(null);
  const activePollTripRequestId = useRef<string | null>(null);
  const seenQuoteIdsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    const payload = peekVerifiedPhoneEmailResume();
    if (payload) {
      setPhoneEmailResumeApplied(true);
      setScreen("booking");
      setDraft({
        ...createDraft(),
        days: payload.days,
        paxCount: payload.paxCount,
        vehicleType: payload.vehicleType,
      });
      setOtp({ ...createOtpState(), step: "verified" });
      setIsVerified(true);
      setBooking(bookingSummaryFromPhoneEmailResume(payload));
      setTripRequestId(payload.tripRequestId);
      setTripNotice(payload.resumedExisting ? ONE_BOOKING_NOTICE : null);
      clearVerifiedPhoneEmailResume();
    }
    setSessionId(getOrCreateClientSessionId());
    setIsClientBootstrapped(true);
  }, []);

  const clearDispatchTimers = useCallback(() => {
    if (dispatchTimer.current) {
      clearInterval(dispatchTimer.current);
      dispatchTimer.current = null;
    }
    if (dispatchTimeout.current) {
      clearTimeout(dispatchTimeout.current);
      dispatchTimeout.current = null;
    }
    if (otpRevealTimeout.current) {
      clearTimeout(otpRevealTimeout.current);
      otpRevealTimeout.current = null;
    }
    if (verifiedTransitionTimeout.current) {
      clearTimeout(verifiedTransitionTimeout.current);
      verifiedTransitionTimeout.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearDispatchTimers();
      activePollTripRequestId.current = null;
    };
  }, [clearDispatchTimers]);

  useEffect(() => {
    let cancelled = false;

    const loadDemoStatus = async () => {
      try {
        const response = await fetch("/api/demo/status");
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { dispatch_delay_ms?: number };
        if (typeof data.dispatch_delay_ms === "number" && data.dispatch_delay_ms > 0) {
          setDispatchDelayMs(data.dispatch_delay_ms);
        }
        setIsDemoFlow(true);
      } catch {
        // Demo timing stays at production default when demo mode is off.
      }
    };

    void loadDemoStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const viewCurrentBooking = useCallback(() => {
    setTripNotice(ONE_BOOKING_NOTICE);
    setOverlay("none");
    setScreen("booking");
  }, []);

  const openSheet = useCallback(() => {
    if (tripRequestId) {
      viewCurrentBooking();
      return;
    }
    setSheetStep(0);
    setIsSubmittingRequest(false);
    setOverlay("sheet");
  }, [tripRequestId, viewCurrentBooking]);

  const closeSheet = useCallback(() => {
    if (isSubmittingRequest) return;
    setOverlay("none");
  }, [isSubmittingRequest]);

  const goToStep = useCallback((step: BookingRequestStep) => setSheetStep(step), []);

  const setDays = useCallback((delta: number) => {
    setDraft((prev) => ({
      ...prev,
      days: Math.min(MAX_TRIP_DAYS, Math.max(MIN_TRIP_DAYS, prev.days + delta)),
    }));
  }, []);

  const setPaxCount = useCallback((delta: number) => {
    setDraft((prev) => ({
      ...prev,
      paxCount: Math.min(MAX_PAX_COUNT, Math.max(MIN_PAX_COUNT, prev.paxCount + delta)),
    }));
  }, []);

  const setVehicleType = useCallback((vehicleType: VehicleTypeCode) => {
    setDraft((prev) => ({ ...prev, vehicleType }));
  }, []);

  const selectDate = useCallback((dateId: string) => {
    setDraft((prev) => ({ ...prev, selectedDateId: dateId, customDate: null }));
  }, []);

  const setCustomDate = useCallback((isoDate: string) => {
    setDraft((prev) => ({ ...prev, selectedDateId: null, customDate: isoDate }));
  }, []);

  const applyPreset = useCallback((days: number) => {
    setDraft((prev) => ({ ...prev, days }));
  }, []);

  // Paces the "checking vendors" animation to the trip's actual matched
  // vendor count (Checklist Phase 4 / Plan §5). The matching screen and OTP
  // sheet now reveal concurrently rather than as two sequential steps: the
  // sheet rises over the still-animating matching screen a short beat after
  // it appears (OTP_SHEET_REVEAL_DELAY_MS), instead of waiting for the full
  // QUOTE_REVEAL_DELAY_MS animation to finish first.
  const runDispatch = useCallback(
    (vendorCount: number) => {
      clearDispatchTimers();
      setDispatchRows(createDispatchRows(vendorCount));
      setIsDispatchActive(true);
      dispatchStartedAtRef.current = Date.now();

      const rowIntervalMs = Math.max(300, Math.floor(dispatchDelayMs / (vendorCount + 1)));
      let index = 0;

      dispatchTimer.current = setInterval(() => {
        index += 1;
        setDispatchRows((rows) =>
          rows.map((row, rowIndex) => ({
            ...row,
            status: rowIndex < index ? "matched" : rowIndex === index ? "matching" : "pending",
          })),
        );
        if (index >= vendorCount && dispatchTimer.current) {
          clearInterval(dispatchTimer.current);
          dispatchTimer.current = null;
        }
      }, rowIntervalMs);

      if (isVerified) {
        // Already verified earlier this session (e.g. resumed login) — no
        // OTP sheet needed, just let the theatrical animation play out once
        // and land straight on the booking screen.
        dispatchTimeout.current = setTimeout(() => {
          clearDispatchTimers();
          setIsDispatchActive(false);
          setOverlay("none");
          setScreen("booking");
        }, dispatchDelayMs);
        return;
      }

      // Not verified yet: bring the OTP sheet up over the matching screen a
      // short beat after it appears, so the two read as one continuous
      // reveal instead of a second popup. The matching animation keeps
      // playing underneath; completeVerification() decides when it's safe
      // to move on.
      otpRevealTimeout.current = setTimeout(() => {
        setOtp((prev) => ({
          ...prev,
          step: "phone",
          code: "",
          error: null,
          isSubmitting: false,
        }));
        setOverlay("otp");
      }, OTP_SHEET_REVEAL_DELAY_MS);
    },
    [clearDispatchTimers, dispatchDelayMs, isVerified],
  );

  const submitRequest = useCallback(async () => {
    const isoDate = resolveTripStartDate(draft);
    if (!isoDate) {
      setRequestError("Pick a departure date to get quotes.");
      return;
    }

    clearDispatchTimers();
    setRequestError(null);
    setDispatchRows([]);
    setIsSubmittingRequest(true);

    if (!sessionId) {
      setIsSubmittingRequest(false);
      setRequestError("Still getting things ready — try again in a moment.");
      setOverlay("sheet");
      return;
    }

    try {
      const response = await fetch("/api/trip-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          trip_start_date: isoDate,
          trip_days: draft.days,
          pax_count: draft.paxCount,
          requested_vehicle_type_id: VEHICLE_TYPE_IDS_BY_CODE[draft.vehicleType],
        }),
      });
      const data = (await response.json().catch(() => null)) as Partial<TripRequestCreateResponse> | null;

      if (!response.ok || typeof data?.trip_request_id !== "string") {
        setTripRequestId(null);
        setIsSubmittingRequest(false);
        setRequestError("Couldn't create your request. Please try again.");
        setOverlay("sheet");
        return;
      }

      setTripRequestId(data.trip_request_id);

      if (data.existing) {
        setTripNotice(ONE_BOOKING_NOTICE);
        setIsVerified(true);
        setBooking({
          bookingRef: buildRequestRef(data.trip_request_id),
          summaryLabel: "Your trip",
          quotes: [],
          selectedQuoteId: null,
          isAwaitingQuotes: false,
        });
        setIsSubmittingRequest(false);
        setOverlay("none");
        setScreen("booking");
        return;
      }

      const matchedVendorCount = typeof data.matched_vendor_count === "number" ? data.matched_vendor_count : 0;

      if (matchedVendorCount <= 0) {
        setIsSubmittingRequest(false);
        setRequestError("No verified operators are available for this route yet. Try different dates or group size.");
        setOverlay("sheet");
        return;
      }

      setIsSubmittingRequest(false);
      runDispatch(matchedVendorCount);
    } catch {
      setTripRequestId(null);
      setIsSubmittingRequest(false);
      setRequestError("Network error. Please try again.");
      setOverlay("sheet");
    }
  }, [clearDispatchTimers, draft, runDispatch, sessionId]);

  const setPhone = useCallback((phone: string) => {
    setOtp((prev) => ({ ...prev, phone: sanitizeIndianPhoneInput(phone), error: null }));
  }, []);

  const setCode = useCallback((code: string) => {
    setOtp((prev) => ({ ...prev, code, error: null }));
  }, []);

  useEffect(() => {
    if (!isClientBootstrapped || !sessionId || phoneEmailResumeApplied) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchGuestTrip(sessionId, null);
        if (cancelled || !result.ok) return;
        setTripRequestId(result.snapshot.tripRequestId);
        setBooking({
          bookingRef: buildRequestRef(result.snapshot.tripRequestId),
          summaryLabel: result.snapshot.tripSummary,
          quotes: [],
          selectedQuoteId: null,
          isAwaitingQuotes: false,
        });
        setIsVerified(true);
        setScreen("booking");
      } catch {
        // A refresh with no network keeps the home screen. The booking tab retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isClientBootstrapped, phoneEmailResumeApplied, sessionId]);

  // Phone Session Login plan: a different tab/device/browser-restart has
  // none of the state the effect above relies on (this tab's sessionId has
  // never been linked to a trip), but the durable login cookie — set after
  // any of the three verification paths (OTP-code, Phone.Email, or
  // "Already booked?" resume) — may still identify the tourist. This asks
  // the server to resolve that cookie, link this tab's sessionId to the
  // tourist's current trip via guest_trip_sessions if one exists, and
  // report back. Deliberately scoped to the current trip only (approved
  // design) — no booking history is restored, and when there is no active
  // trip this only restores the profile's phone identity, leaving
  // isVerified/tripRequestId untouched so a brand-new booking still goes
  // through the normal OTP flow (which is the only path that links
  // tourist_id and enqueues send_quotes for that new trip).
  useEffect(() => {
    if (!isClientBootstrapped || !sessionId || phoneEmailResumeApplied) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/auth/session?session_id=${encodeURIComponent(sessionId)}`);
        if (cancelled) return;
        const data = (await response.json().catch(() => null)) as {
          authenticated?: boolean;
          touristId?: string;
          phoneE164?: string;
          tripRequestId?: string | null;
        } | null;

        if (!response.ok || !data?.authenticated || !data.touristId || !data.phoneE164) return;
        setCustomerIdentity({ touristId: data.touristId, phoneE164: data.phoneE164 });

        if (!data.tripRequestId) return;

        // Server already linked this tab's sessionId above — fresh=true
        // bypasses the client cache so this read isn't skipped as a dedupe
        // of the (likely 404, pre-link) call the effect above just made.
        const result = await fetchGuestTrip(sessionId, null, true);
        if (cancelled || !result.ok) return;
        setTripRequestId(result.snapshot.tripRequestId);
        setBooking({
          bookingRef: buildRequestRef(result.snapshot.tripRequestId),
          summaryLabel: result.snapshot.tripSummary,
          quotes: [],
          selectedQuoteId: null,
          isAwaitingQuotes: false,
        });
        setIsVerified(true);
        setScreen("booking");
      } catch {
        // Offline on first paint: stays in guest mode: the next visit (or
        // this tab's own guest-trip polling, once a trip exists) retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isClientBootstrapped, phoneEmailResumeApplied, sessionId]);

  // Shared by both verification paths (Plan §8): OTP-code success and
  // Phone.Email fallback success both land here.
  const completeVerification = useCallback((resolvedTripId?: string) => {
    const activeTripId = resolvedTripId ?? tripRequestId;
    if (!activeTripId) {
      setOtp((prev) => ({
        ...prev,
        isSubmitting: false,
        error: "Something went wrong with your request. Please start over.",
      }));
      return;
    }

    if (resolvedTripId) setTripRequestId(resolvedTripId);
    seenQuoteIdsRef.current = new Set();
    setBooking({
      bookingRef: buildRequestRef(activeTripId),
      summaryLabel: `${draft.days} days · ${draft.paxCount} travellers · ${draft.vehicleType.toUpperCase()}`,
      quotes: [],
      selectedQuoteId: null,
      isAwaitingQuotes: false,
    });
    setIsVerified(true);
    setOtp((prev) => ({ ...prev, isSubmitting: false, step: "verified", error: null }));

    // Never let the "You're in." success beat cut the matching animation
    // short: if it's still mid-flight (dispatchStartedAtRef set, i.e. a new
    // request's runDispatch is active), hold until it would have finished
    // anyway. Resume-flow verifications never set dispatchStartedAtRef, so
    // this falls straight back to the baseline success-beat duration.
    const elapsedSinceDispatchStart = dispatchStartedAtRef.current
      ? Date.now() - dispatchStartedAtRef.current
      : Number.POSITIVE_INFINITY;
    const transitionDelay = computeVerifiedTransitionDelayMs(
      elapsedSinceDispatchStart,
      dispatchDelayMs,
      VERIFIED_SUCCESS_BEAT_MS,
    );

    if (verifiedTransitionTimeout.current) clearTimeout(verifiedTransitionTimeout.current);
    verifiedTransitionTimeout.current = setTimeout(() => {
      verifiedTransitionTimeout.current = null;
      clearDispatchTimers();
      setIsDispatchActive(false);
      setOverlay("none");
      setScreen("booking");
    }, transitionDelay);
  }, [clearDispatchTimers, dispatchDelayMs, draft.days, draft.paxCount, draft.vehicleType, tripRequestId]);

  const sendOtp = useCallback(async (prefer?: "whatsapp") => {
    const localDigits = sanitizeIndianPhoneInput(otp.phone);
    if (!isValidIndianMobile(localDigits)) {
      setOtp((prev) => ({
        ...prev,
        error: localDigits.length < 10 ? "Enter a valid 10-digit number" : "Enter a valid Indian mobile number",
      }));
      return;
    }
    if (!sessionId) {
      setOtp((prev) => ({ ...prev, error: "Still getting things ready — try again in a moment." }));
      return;
    }

    console.info("[otp client] send start", { prefer: prefer ?? "sms", last4: phoneLast4(localDigits) });
    setOtp((prev) => ({ ...prev, isSubmitting: true, error: null }));

    try {
      const response = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          phone_e164: toIndianE164(localDigits),
          ...(prefer ? { prefer } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      console.info("[otp client] send http", response.status);
      console.info("[otp client] send body", {
        sent: data?.sent,
        channel: data?.channel,
        fallback: data?.fallback,
      });

      if (!response.ok) {
        console.info("[otp client] step", "error");
        setOtp((prev) => ({
          ...prev,
          isSubmitting: false,
          error: (data as { error?: string } | null)?.error ?? "Couldn't send OTP. Try again.",
        }));
        return;
      }

      if (data?.fallback === "phone_email") {
        console.info("[otp client] step", "phone_email");
        setOtp((prev) => ({
          ...prev,
          isSubmitting: false,
          step: "phone_email",
          deliveryChannel: null,
          phoneEmailMode: getPhoneEmailProviderMode(),
          error: null,
        }));
        return;
      }

      const channel = data?.channel as OtpDeliveryChannel | undefined;
      const demoOtpCode = typeof data?.demo_otp_code === "string" ? data.demo_otp_code : null;
      if (data?.sent && (channel === "whatsapp" || channel === "sms")) {
        console.info("[otp client] step", "code");
        setOtp((prev) => ({
          ...prev,
          isSubmitting: false,
          step: "code",
          deliveryChannel: channel,
          demoOtpCode,
          error: null,
        }));
        return;
      }

      console.info("[otp client] step", "error");
      setOtp((prev) => ({ ...prev, isSubmitting: false, error: "Couldn't send OTP. Try again." }));
    } catch {
      console.info("[otp client] step", "error");
      setOtp((prev) => ({ ...prev, isSubmitting: false, error: "Network error. Try again." }));
    }
  }, [otp.phone, sessionId]);

  const verifyOtp = useCallback(async () => {
    if (otp.code.length < OTP_CODE_LENGTH) {
      setOtp((prev) => ({ ...prev, error: `Enter the ${OTP_CODE_LENGTH}-digit code` }));
      return;
    }
    if (!sessionId || (!resumeMode && !tripRequestId)) {
      setOtp((prev) => ({ ...prev, error: "Something went wrong with your request. Please start over." }));
      return;
    }

    console.info("[otp client] verify start", {
      last4: phoneLast4(otp.phone),
      codeLength: otp.code.length,
    });
    setOtp((prev) => ({ ...prev, isSubmitting: true, error: null }));

    try {
      const response = await fetch(resumeMode ? "/api/guest-trip/resume" : "/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          phone_e164: toIndianE164(otp.phone),
          otp_code: otp.code,
          ...(resumeMode ? {} : { trip_request_id: tripRequestId }),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        trip_request_id?: string;
        tripRequestId?: string;
        resumed_existing?: boolean;
        found?: boolean;
      } | null;
      console.info("[otp client] verify http", response.status);

      if (resumeMode && response.ok && data?.found === false) {
        setResumeMode(false);
        setOtp((prev) => ({
          ...prev,
          isSubmitting: false,
          step: "no_booking",
          code: "",
          error: null,
        }));
        return;
      }

      if (!response.ok) {
        const errorMessage = data?.error ?? "Incorrect OTP";
        console.info("[otp client] verify fail", errorMessage);
        setOtp((prev) => ({
          ...prev,
          isSubmitting: false,
          error: errorMessage,
        }));
        return;
      }

      console.info("[otp client] verify ok");
      if (data?.resumed_existing) {
        setTripNotice(ONE_BOOKING_NOTICE);
      }
      if (resumeMode) {
        setResumeMode(false);
        completeVerification(data?.tripRequestId);
        return;
      }
      completeVerification(data?.resumed_existing ? data.trip_request_id : undefined);
    } catch {
      console.info("[otp client] verify fail", "network");
      setOtp((prev) => ({ ...prev, isSubmitting: false, error: "Network error. Try again." }));
    }
  }, [completeVerification, otp.code, otp.phone, resumeMode, sessionId, tripRequestId]);

  // Passed to PhoneEmailAdapter as onBeforeRedirect: the tab is about to
  // navigate away to Phone.Email and back (Plan: Phone.Email Full Redirect
  // Flow), so this hook's whole in-memory state — including tripRequestId,
  // which app/phone-email/callback/page.tsx needs to call the verify API —
  // won't survive. This is the only state that needs to survive the trip.
  const persistPhoneEmailResumeState = useCallback(() => {
    if (typeof window === "undefined" || !tripRequestId) return;
    writePendingPhoneEmailResume({
      tripRequestId,
      days: draft.days,
      paxCount: draft.paxCount,
      vehicleType: draft.vehicleType,
    });
  }, [draft.days, draft.paxCount, draft.vehicleType, tripRequestId]);

  const editPhone = useCallback(() => {
    setOtp((prev) => ({ ...prev, step: "phone", code: "", deliveryChannel: null, error: null }));
  }, []);

  const navigateProfile = useCallback(() => setScreen("profile"), []);

  const selectQuote = useCallback((quoteId: string) => {
    setBooking((prev) => {
      if (!prev) return prev
      if (!prev.quotes.some((quote) => quote.id === quoteId)) return prev
      return { ...prev, selectedQuoteId: quoteId }
    })
  }, []);

  const selectedQuote = useMemo(() => {
    if (!booking?.selectedQuoteId) return null
    return booking.quotes.find((quote) => quote.id === booking.selectedQuoteId) ?? null
  }, [booking])

  const openMockChat = useCallback(() => {
    if (!tripRequestId) return;
    setOverlay("mock_chat");
  }, [tripRequestId]);

  const closeMockChat = useCallback(() => {
    setOverlay("none");
  }, []);

  const clearBooking = useCallback(() => {
    const currentSession = sessionId;
    if (currentSession) {
      clearCachedGuestTrip(currentSession);
      // ProfileScreen's "Clear booking & sign out" / "Sign out" is one
      // button either way (Phone Session Login plan keeps that existing
      // copy/behavior), so this also signs out of the durable 7-day login
      // cookie — never implicitly from any other action, and this never
      // cancels a booking on its own (cancel below only ever acts on the
      // current trip).
      //
      // These two calls MUST be sequenced, not fired in parallel:
      // - /api/guest-trip/cancel looks up this tab's trip via the
      //   guest_trip_sessions row for currentSession; /api/auth/session's
      //   DELETE best-effort-deletes that very row. Firing both at once
      //   races cancel against its own lookup data disappearing, so cancel
      //   can silently 404 and never actually abandon the trip.
      // - Rotating this tab's session_id (below) must wait until the
      //   cookie is actually cleared, otherwise the brand-new session_id's
      //   hydration fetch (GET /api/auth/session) can still see the
      //   not-yet-cleared cookie and re-link the "signed out" tab straight
      //   back to the trip we just cancelled.
      void (async () => {
        try {
          await fetch("/api/guest-trip/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: currentSession }),
          });
        } catch {
          // Best-effort — sign-out must still proceed below either way.
        }
        try {
          await fetch("/api/auth/session", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: currentSession }),
          });
        } catch {
          // Best-effort — the cookie may already be gone/expired.
        }
        if (typeof window !== "undefined") {
          setSessionId(resetClientSessionId());
        }
      })();
    } else if (typeof window !== "undefined") {
      setSessionId(resetClientSessionId());
    }
    activePollTripRequestId.current = null;
    seenQuoteIdsRef.current = new Set();
    dispatchStartedAtRef.current = null;
    clearDispatchTimers();
    clearPhoneEmailResumeState();

    setTripRequestId(null);
    setBooking(null);
    setIsVerified(false);
    setCustomerIdentity(null);
    setOtp(createOtpState());
    setDraft(createDraft());
    setDispatchRows([]);
    setIsDispatchActive(false);
    setRequestError(null);
    setIsSubmittingRequest(false);
    setSheetStep(0);
    setOverlay("none");
    setTripNotice(null);
    setResumeMode(false);
    setScreen("home");
  }, [clearDispatchTimers, sessionId]);

  const openResume = useCallback(() => {
    setResumeMode(true);
    setOtp((prev) => ({ ...createOtpState(), phone: prev.phone }));
    setOverlay("otp");
  }, []);

  const startFromNoBooking = useCallback(() => {
    setResumeMode(false);
    setOtp((prev) => ({
      ...prev,
      step: "phone",
      code: "",
      deliveryChannel: null,
      demoOtpCode: null,
      error: null,
      isSubmitting: false,
    }));
    setSheetStep(0);
    setIsSubmittingRequest(false);
    setScreen("home");
    setOverlay("sheet");
  }, []);

  const navigateBooking = useCallback(() => setScreen("booking"), []);

  const rememberSnapshot = useCallback((snapshot: { tripRequestId: string; tripSummary: string }) => {
    setTripRequestId(snapshot.tripRequestId);
    setBooking((prev) => ({
      bookingRef: buildRequestRef(snapshot.tripRequestId),
      summaryLabel: snapshot.tripSummary,
      quotes: prev?.quotes ?? [],
      selectedQuoteId: prev?.selectedQuoteId ?? null,
      isAwaitingQuotes: false,
    }));
    setIsVerified(true);
  }, []);

  const recommendation = buildRecommendation(draft.days, draft.paxCount, draft.vehicleType);
  const requestRef = buildRequestRef(tripRequestId);
  // Full E.164 from the durable login session — takes priority over
  // otp.phone (local 10 digits, only ever set during an in-progress OTP
  // flow) for display purposes, since it survives refreshes/new tabs.
  const verifiedPhoneE164 = customerIdentity?.phoneE164 ?? null;

  return {
    screen,
    overlay,
    sheetStep,
    draft,
    dispatchRows,
    isDispatchActive,
    otp,
    booking,
    selectedQuote,
    isDemoFlow,
    recommendation,
    requestError,
    isSubmittingRequest,
    requestRef,
    tripRequestId,
    sessionId,
    verifiedPhoneE164,
    tripNotice,
    navigateHome: () => setScreen("home"),
    navigateBooking,
    navigateProfile,
    openSheet,
    closeSheet,
    goToStep,
    setDays,
    setPaxCount,
    setVehicleType,
    selectDate,
    setCustomDate,
    applyPreset,
    submitRequest,
    setPhone,
    setCode,
    sendOtp,
    verifyOtp,
    persistPhoneEmailResumeState,
    editPhone,
    selectQuote,
    openMockChat,
    closeMockChat,
    clearBooking,
    openResume,
    startFromNoBooking,
    viewCurrentBooking,
    rememberSnapshot,
  };
}

export type BookingFlow = ReturnType<typeof useBookingFlow>;
