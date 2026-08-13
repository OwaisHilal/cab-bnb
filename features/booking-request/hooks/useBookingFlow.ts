"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_PAX_COUNT,
  MAX_TRIP_DAYS,
  MIN_PAX_COUNT,
  MIN_TRIP_DAYS,
  SEDAN_SEAT_CAPACITY,
  UPCOMING_DATES,
  VEHICLE_TYPE_IDS_BY_CODE,
  VEHICLE_TYPES,
} from "@/features/booking-request/constants";
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
import { getOrCreateClientSessionId } from "@/lib/utils/clientSession";
import { toIndianE164 } from "@/lib/utils/phone";
import { getPhoneEmailProviderMode } from "@/features/phone-email/components/PhoneEmailAdapter";
import type { PhoneEmailClientPayload } from "@/features/phone-email/components/PhoneEmailAdapter";

type PrimaryScreen = "home" | "booking" | "profile";
type Overlay = "none" | "sheet" | "dispatch" | "otp";

// Retries for ~90s: covers one app/api/cron/dispatch-jobs cycle (every 1
// min, per vercel.json) plus buffer for send-quotes to actually deliver,
// without polling indefinitely if something upstream is stuck.
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
    name: `Verified operator ${index + 1}`,
    status: "pending" as const,
  }));
}

function createOtpState(): OtpState {
  return {
    step: "phone",
    phone: "",
    code: "",
    deliveryChannel: null,
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
  const [screen, setScreen] = useState<PrimaryScreen>("home");
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [sheetStep, setSheetStep] = useState<BookingRequestStep>(0);
  const [draft, setDraft] = useState<BookingRequestDraft>(createDraft);
  const [dispatchRows, setDispatchRows] = useState<DispatchVendorRow[]>([]);
  const [otp, setOtp] = useState<OtpState>(createOtpState);
  const [isVerified, setIsVerified] = useState(false);
  const [booking, setBooking] = useState<BookingSummaryUi | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Lazy-initialized rather than set in an effect: sessionStorage isn't
  // available during SSR, so this resolves to "" on the server and the
  // real session id on the client's first render — no rendered output
  // depends on this value, so there's nothing for hydration to mismatch on.
  const [sessionId] = useState<string>(() =>
    typeof window === "undefined" ? "" : getOrCreateClientSessionId(),
  );
  const [tripRequestId, setTripRequestId] = useState<string | null>(null);

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

  const openSheet = useCallback(() => {
    setSheetStep(0);
    setOverlay("sheet");
  }, []);

  const closeSheet = useCallback(() => setOverlay("none"), []);

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

      const rowIntervalMs = Math.max(300, Math.floor(QUOTE_REVEAL_DELAY_MS / (vendorCount + 1)));
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
      }, QUOTE_REVEAL_DELAY_MS);
    },
    [clearDispatchTimers, isVerified],
  );

  const submitRequest = useCallback(async () => {
    clearDispatchTimers();
    setOverlay("none");
    setRequestError(null);
    setDispatchRows([]);

    if (!sessionId) {
      setRequestError("Still getting things ready — try again in a moment.");
      setOverlay("sheet");
      return;
    }

    const isoDate =
      draft.customDate ??
      UPCOMING_DATES.find((date) => date.id === draft.selectedDateId)?.isoDate ??
      UPCOMING_DATES[0].isoDate;

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
        setRequestError("Couldn't create your request. Please try again.");
        setOverlay("sheet");
        return;
      }

      setTripRequestId(data.trip_request_id);

      const matchedVendorCount = typeof data.matched_vendor_count === "number" ? data.matched_vendor_count : 0;

      if (matchedVendorCount <= 0) {
        setRequestError("No verified operators are available for this route yet. Try different dates or group size.");
        setOverlay("sheet");
        return;
      }

      runDispatch(matchedVendorCount);
    } catch {
      setTripRequestId(null);
      setRequestError("Network error. Please try again.");
      setOverlay("sheet");
    }
  }, [clearDispatchTimers, draft, runDispatch, sessionId]);

  const setPhone = useCallback((phone: string) => {
    setOtp((prev) => ({ ...prev, phone, error: null }));
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
            setBooking((prev) => (prev ? { ...prev, quotes: rows, isAwaitingQuotes: false } : prev));
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

  const sendOtp = useCallback(async () => {
    const localDigits = otp.phone.replace(/\D/g, "");
    if (localDigits.length < 10) {
      setOtp((prev) => ({ ...prev, error: "Enter a valid 10-digit number" }));
      return;
    }
    if (!sessionId) {
      setOtp((prev) => ({ ...prev, error: "Still getting things ready — try again in a moment." }));
      return;
    }

    setOtp((prev) => ({ ...prev, isSubmitting: true, error: null }));

    try {
      const response = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, phone_e164: toIndianE164(localDigits) }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setOtp((prev) => ({
          ...prev,
          isSubmitting: false,
          error: (data as { error?: string } | null)?.error ?? "Couldn't send OTP. Try again.",
        }));
        return;
      }

      if (data?.fallback === "phone_email") {
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
      if (data?.sent && (channel === "whatsapp" || channel === "sms")) {
        setOtp((prev) => ({ ...prev, isSubmitting: false, step: "code", deliveryChannel: channel, error: null }));
        return;
      }

      setOtp((prev) => ({ ...prev, isSubmitting: false, error: "Couldn't send OTP. Try again." }));
    } catch {
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

      if (!response.ok) {
        setOtp((prev) => ({
          ...prev,
          isSubmitting: false,
          error: (data as { error?: string } | null)?.error ?? "Incorrect OTP",
        }));
        return;
      }

      completeVerification();
    } catch {
      setOtp((prev) => ({ ...prev, isSubmitting: false, error: "Network error. Try again." }));
    }
  }, [completeVerification, otp.code, otp.phone, sessionId, tripRequestId]);

  const verifyPhoneEmail = useCallback(
    async (providerPayload: PhoneEmailClientPayload) => {
      if (!sessionId || !tripRequestId) {
        setOtp((prev) => ({ ...prev, error: "Something went wrong with your request. Please start over." }));
        return;
      }

      setOtp((prev) => ({ ...prev, isSubmitting: true, error: null }));

      try {
        const response = await fetch("/api/otp/phone-email/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            trip_request_id: tripRequestId,
            provider_payload: providerPayload,
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          setOtp((prev) => ({
            ...prev,
            isSubmitting: false,
            error: (data as { error?: string } | null)?.error ?? "Couldn't verify with Phone.Email.",
          }));
          return;
        }

        completeVerification();
      } catch {
        setOtp((prev) => ({ ...prev, isSubmitting: false, error: "Network error. Try again." }));
      }
    },
    [completeVerification, sessionId, tripRequestId],
  );

  const editPhone = useCallback(() => {
    setOtp((prev) => ({ ...prev, step: "phone", code: "", deliveryChannel: null, error: null }));
  }, []);

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
    recommendation,
    requestError,
    requestRef,
    navigateHome: () => setScreen("home"),
    navigateBooking: () => setScreen("booking"),
    navigateProfile: () => setScreen("profile"),
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
    verifyPhoneEmail,
    editPhone,
  };
}

export type BookingFlow = ReturnType<typeof useBookingFlow>;
