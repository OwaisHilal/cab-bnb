"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { QUOTE_REVEAL_DELAY_MS } from "@/features/quote-dispatch/constants";
import type { DispatchVendorRow } from "@/features/quote-dispatch/types";
import { OTP_CODE_LENGTH } from "@/features/whatsapp-otp/types";
import type { OtpDeliveryChannel, OtpState } from "@/features/whatsapp-otp/types";
import type { BookingSummaryUi, QuoteRowUi, QuoteSnapshotStatusUi } from "@/features/booking-status/types";
import { pickDefaultSelectedQuoteId } from "@/features/booking-status/quoteActions";
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

type PrimaryScreen = "home" | "booking" | "profile";
type Overlay = "none" | "sheet" | "dispatch" | "otp" | "mock_chat";

// Retries for ~90s: send_quotes drains on OTP verify; this buffer covers
// MSG91 delivery + snapshot write, without polling indefinitely if
// something upstream is stuck.
const QUOTE_POLL_INTERVAL_MS = 3000;
const QUOTE_POLL_MAX_ATTEMPTS = 30;

const QUOTE_SNAPSHOT_STATUSES: readonly QuoteSnapshotStatusUi[] = [
  "pending_send",
  "sent",
  "viewed",
  "negotiating",
  "finalized",
  "expired",
  "lost",
];

function isKnownQuoteStatus(value: string): value is QuoteSnapshotStatusUi {
  return (QUOTE_SNAPSHOT_STATUSES as readonly string[]).includes(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TripRequestCreateResponse {
  trip_request_id: string;
  matched_vendor_count: number;
  recommendation: { recommended_vehicle_type_id: number; reason: string | null } | null;
}

interface TripRequestSnapshotQuote {
  id: string;
  vendor_name: string;
  vehicle_type_label: string;
  current_quote: number;
  is_best_price: boolean;
  status: string;
}

interface TripRequestSnapshotResponse {
  trip_request_id: string;
  status: string;
  matched_vendor_count: number;
  quotes: TripRequestSnapshotQuote[];
}

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

function toQuoteRowUi(quote: TripRequestSnapshotQuote, previouslySeenIds: ReadonlySet<string>): QuoteRowUi {
  return {
    id: quote.id,
    vendorName: quote.vendor_name,
    priceLabel: `\u20b9${quote.current_quote.toLocaleString("en-IN")}`,
    isBestPrice: quote.is_best_price,
    status: isKnownQuoteStatus(quote.status) ? quote.status : "sent",
    isNew: !previouslySeenIds.has(quote.id),
  };
}

export function useBookingFlow() {
  // The Phone.Email fallback now redirects the whole tab away and back
  // (lib/phone-email/resumeState.ts) rather than using a popup, so this
  // hook's previous instance is gone by the time the user returns — this
  // peeks sessionStorage once, synchronously, to seed the states below as
  // if verification had just completed in-place. Deliberately non-
  // destructive (see peekVerifiedPhoneEmailResume's docs): the actual
  // sessionStorage cleanup happens in an effect further down, since that's
  // idempotent and safe under React Strict Mode's dev-only double-invoke,
  // unlike seeding several useState initializers from a single destructive
  // read would be.
  const [resumedPhoneEmailPayload] = useState<PhoneEmailResumePayload | null>(() =>
    typeof window === "undefined" ? null : peekVerifiedPhoneEmailResume(),
  );

  const [screen, setScreen] = useState<PrimaryScreen>(() => (resumedPhoneEmailPayload ? "booking" : "home"));
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [sheetStep, setSheetStep] = useState<BookingRequestStep>(0);
  const [draft, setDraft] = useState<BookingRequestDraft>(() =>
    resumedPhoneEmailPayload
      ? {
          ...createDraft(),
          days: resumedPhoneEmailPayload.days,
          paxCount: resumedPhoneEmailPayload.paxCount,
          vehicleType: resumedPhoneEmailPayload.vehicleType,
        }
      : createDraft(),
  );
  const [dispatchRows, setDispatchRows] = useState<DispatchVendorRow[]>([]);
  const [otp, setOtp] = useState<OtpState>(() => {
    const base = createOtpState();
    return resumedPhoneEmailPayload ? { ...base, step: "verified" } : base;
  });
  const [isVerified, setIsVerified] = useState(() => Boolean(resumedPhoneEmailPayload));
  const [booking, setBooking] = useState<BookingSummaryUi | null>(() =>
    resumedPhoneEmailPayload
      ? {
          bookingRef: buildRequestRef(resumedPhoneEmailPayload.tripRequestId),
          summaryLabel: `${resumedPhoneEmailPayload.days} days · ${resumedPhoneEmailPayload.paxCount} travellers · ${resumedPhoneEmailPayload.vehicleType.toUpperCase()}`,
          quotes: [],
          selectedQuoteId: null,
          isAwaitingQuotes: true,
        }
      : null,
  );
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  // Lazy-initialized rather than set in an effect: sessionStorage isn't
  // available during SSR, so this resolves to "" on the server and the
  // real session id on the client's first render — no rendered output
  // depends on this value, so there's nothing for hydration to mismatch on.
  const [sessionId, setSessionId] = useState<string>(() =>
    typeof window === "undefined" ? "" : getOrCreateClientSessionId(),
  );
  const [tripRequestId, setTripRequestId] = useState<string | null>(
    () => resumedPhoneEmailPayload?.tripRequestId ?? null,
  );
  const [dispatchDelayMs, setDispatchDelayMs] = useState(QUOTE_REVEAL_DELAY_MS);
  const [isDemoFlow, setIsDemoFlow] = useState(false);

  const dispatchTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dispatchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePollTripRequestId = useRef<string | null>(null);
  const seenQuoteIdsRef = useRef<Set<string>>(new Set());

  const clearDispatchTimers = useCallback(() => {
    if (dispatchTimer.current) {
      clearInterval(dispatchTimer.current);
      dispatchTimer.current = null;
    }
    if (dispatchTimeout.current) {
      clearTimeout(dispatchTimeout.current);
      dispatchTimeout.current = null;
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

  const openSheet = useCallback(() => {
    setSheetStep(0);
    setIsSubmittingRequest(false);
    setOverlay("sheet");
  }, []);

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
  // vendor count (Checklist Phase 4 / Plan §5) while still guaranteeing the
  // OTP modal appears after exactly QUOTE_REVEAL_DELAY_MS, regardless of
  // how many rows there are to animate through.
  const runDispatch = useCallback(
    (vendorCount: number) => {
      clearDispatchTimers();
      setDispatchRows(createDispatchRows(vendorCount));
      setOverlay("dispatch");

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

      dispatchTimeout.current = setTimeout(() => {
        clearDispatchTimers();
        setOverlay(isVerified ? "none" : "otp");
        if (isVerified) setScreen("booking");
      }, dispatchDelayMs);
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

  // Polls the customer-safe GET /api/trip-requests/[id] snapshot (Checklist
  // 2.2 fallback path — option "b" from the Phase 4 audit) instead of a
  // browser Realtime subscription, since RLS on trip_requests/quote_snapshots
  // has no anon SELECT policy today (migration 0008). Stops as soon as any
  // quote rows come back, on exhausting QUOTE_POLL_MAX_ATTEMPTS, or once a
  // newer trip request supersedes this one via `activePollTripRequestId`.
  //
  // Phase 5 readiness fix pass (audit gap G3): Realtime is intentionally
  // deferred rather than implemented here. Wiring browser Supabase Realtime
  // today would require either an anon SELECT policy on trip_requests/
  // quote_snapshots (widening exposure beyond the service-role-only model
  // in 0008_rls_policies.sql) or a UUID-only access-control workaround,
  // both of which are security regressions. Revisit once the auth/RLS
  // model has a real per-session/per-tourist identity to scope Realtime
  // subscriptions to; keep this polling fallback as the sole delivery
  // path until then.
  const pollTripRequestSnapshot = useCallback(async (requestId: string) => {
    activePollTripRequestId.current = requestId;

    for (let attempt = 0; attempt < QUOTE_POLL_MAX_ATTEMPTS; attempt += 1) {
      if (activePollTripRequestId.current !== requestId) return;

      try {
        const response = await fetch(`/api/trip-requests/${requestId}`);
        const data = (await response.json().catch(() => null)) as Partial<TripRequestSnapshotResponse> | null;

        if (response.ok && data && Array.isArray(data.quotes) && data.quotes.length > 0) {
          const rows = data.quotes.map((quote) => toQuoteRowUi(quote, seenQuoteIdsRef.current));
          seenQuoteIdsRef.current = new Set(data.quotes.map((quote) => quote.id));
          if (activePollTripRequestId.current === requestId) {
            setBooking((prev) =>
              prev
                ? {
                    ...prev,
                    quotes: rows,
                    isAwaitingQuotes: false,
                    selectedQuoteId: prev.selectedQuoteId ?? pickDefaultSelectedQuoteId(rows),
                  }
                : prev,
            );
          }
          return;
        }
      } catch {
        // Transient network error — fall through and retry on the next attempt.
      }

      if (activePollTripRequestId.current !== requestId) return;
      await sleep(QUOTE_POLL_INTERVAL_MS);
    }

    if (activePollTripRequestId.current === requestId) {
      setBooking((prev) => (prev ? { ...prev, isAwaitingQuotes: false } : prev));
    }
  }, []);

  // Finishes the resume seeded by resumedPhoneEmailPayload above: clears
  // the one-time flag (idempotent, safe under Strict Mode's dev-only
  // double-invoke — unlike the useState seeding, this is a plain external
  // side effect, not a setState call) and starts the same quote poll
  // completeVerification() would have started.
  useEffect(() => {
    if (!resumedPhoneEmailPayload) return;
    clearVerifiedPhoneEmailResume();
    void pollTripRequestSnapshot(resumedPhoneEmailPayload.tripRequestId);
  }, [resumedPhoneEmailPayload, pollTripRequestSnapshot]);

  // Shared by both verification paths (Plan §8): OTP-code success and
  // Phone.Email fallback success both land here.
  const completeVerification = useCallback(() => {
    if (!tripRequestId) {
      setOtp((prev) => ({
        ...prev,
        isSubmitting: false,
        error: "Something went wrong with your request. Please start over.",
      }));
      return;
    }

    seenQuoteIdsRef.current = new Set();
    setBooking({
      bookingRef: buildRequestRef(tripRequestId),
      summaryLabel: `${draft.days} days · ${draft.paxCount} travellers · ${draft.vehicleType.toUpperCase()}`,
      quotes: [],
      selectedQuoteId: null,
      isAwaitingQuotes: true,
    });
    setIsVerified(true);
    setOtp((prev) => ({ ...prev, isSubmitting: false, step: "verified", error: null }));
    void pollTripRequestSnapshot(tripRequestId);
    setTimeout(() => {
      setOverlay("none");
      setScreen("booking");
    }, 900);
  }, [draft.days, draft.paxCount, draft.vehicleType, pollTripRequestSnapshot, tripRequestId]);

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
    if (!sessionId || !tripRequestId) {
      setOtp((prev) => ({ ...prev, error: "Something went wrong with your request. Please start over." }));
      return;
    }

    console.info("[otp client] verify start", {
      last4: phoneLast4(otp.phone),
      codeLength: otp.code.length,
    });
    setOtp((prev) => ({ ...prev, isSubmitting: true, error: null }));

    try {
      const response = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          phone_e164: toIndianE164(otp.phone),
          otp_code: otp.code,
          trip_request_id: tripRequestId,
        }),
      });
      const data = await response.json().catch(() => null);
      console.info("[otp client] verify http", response.status);

      if (!response.ok) {
        const errorMessage = (data as { error?: string } | null)?.error ?? "Incorrect OTP";
        console.info("[otp client] verify fail", errorMessage);
        setOtp((prev) => ({
          ...prev,
          isSubmitting: false,
          error: errorMessage,
        }));
        return;
      }

      console.info("[otp client] verify ok");
      completeVerification();
    } catch {
      console.info("[otp client] verify fail", "network");
      setOtp((prev) => ({ ...prev, isSubmitting: false, error: "Network error. Try again." }));
    }
  }, [completeVerification, otp.code, otp.phone, sessionId, tripRequestId]);

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
    activePollTripRequestId.current = null;
    seenQuoteIdsRef.current = new Set();
    clearDispatchTimers();
    clearPhoneEmailResumeState();

    if (typeof window !== "undefined") {
      setSessionId(resetClientSessionId());
    }

    setTripRequestId(null);
    setBooking(null);
    setIsVerified(false);
    setOtp(createOtpState());
    setDraft(createDraft());
    setDispatchRows([]);
    setRequestError(null);
    setIsSubmittingRequest(false);
    setSheetStep(0);
    setOverlay("none");
    setScreen("home");
  }, [clearDispatchTimers]);

  const recommendation = buildRecommendation(draft.days, draft.paxCount, draft.vehicleType);
  const requestRef = buildRequestRef(tripRequestId);

  return {
    screen,
    overlay,
    sheetStep,
    draft,
    dispatchRows,
    otp,
    booking,
    selectedQuote,
    isDemoFlow,
    recommendation,
    requestError,
    isSubmittingRequest,
    requestRef,
    tripRequestId,
    navigateHome: () => setScreen("home"),
    navigateBooking: () => setScreen("booking"),
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
  };
}

export type BookingFlow = ReturnType<typeof useBookingFlow>;
