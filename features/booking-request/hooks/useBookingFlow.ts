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
import {
  DISPATCH_ROW_INTERVAL_MS,
} from "@/features/quote-dispatch/constants";
import type { DispatchVendorRow } from "@/features/quote-dispatch/types";
import { OTP_CODE_LENGTH } from "@/features/whatsapp-otp/types";
import type { OtpDeliveryChannel, OtpState } from "@/features/whatsapp-otp/types";
import type { BookingSummaryUi, QuoteRowUi } from "@/features/booking-status/types";
import { getOrCreateClientSessionId } from "@/lib/utils/clientSession";
import { toIndianE164 } from "@/lib/utils/phone";
import { getPhoneEmailProviderMode } from "@/features/phone-email/components/PhoneEmailAdapter";
import type { PhoneEmailClientPayload } from "@/features/phone-email/components/PhoneEmailAdapter";

type PrimaryScreen = "home" | "booking" | "profile";
type Overlay = "none" | "sheet" | "dispatch" | "otp";

const VENDOR_ROSTER = ["Vale Cabs", "Himways", "GK Tours", "Snowline", "Zoji Go"];

function createDraft(): BookingRequestDraft {
  return {
    days: 5,
    paxCount: 2,
    vehicleType: "sedan",
    selectedDateId: null,
    customDate: null,
  };
}

function createDispatchRows(): DispatchVendorRow[] {
  return VENDOR_ROSTER.map((name, index) => ({
    id: `vendor-${index}`,
    name,
    status: "pending",
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

function buildMockQuotes(days: number, vehicleType: VehicleTypeCode): QuoteRowUi[] {
  const baseByVehicle: Record<VehicleTypeCode, number> = {
    sedan: 3400,
    suv: 5400,
    tempo: 8200,
  };
  const base = baseByVehicle[vehicleType] * days;
  return VENDOR_ROSTER.slice(0, 3).map((name, index) => {
    const price = Math.round((base + index * 1500) / 50) * 50;
    return {
      id: `quote-${index}`,
      vendorName: name,
      priceLabel: `₹${price.toLocaleString("en-IN")}`,
      isBestPrice: index === 0,
      status: "sent",
      isNew: index === 0,
    };
  });
}

export function useBookingFlow() {
  const [screen, setScreen] = useState<PrimaryScreen>("home");
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [sheetStep, setSheetStep] = useState<BookingRequestStep>(0);
  const [draft, setDraft] = useState<BookingRequestDraft>(createDraft);
  const [dispatchRows, setDispatchRows] = useState<DispatchVendorRow[]>(createDispatchRows);
  const [otp, setOtp] = useState<OtpState>(createOtpState);
  const [isVerified, setIsVerified] = useState(false);
  const [booking, setBooking] = useState<BookingSummaryUi | null>(null);
  // Lazy-initialized rather than set in an effect: sessionStorage isn't
  // available during SSR, so this resolves to "" on the server and the
  // real session id on the client's first render — no rendered output
  // depends on this value, so there's nothing for hydration to mismatch on.
  const [sessionId] = useState<string>(() =>
    typeof window === "undefined" ? "" : getOrCreateClientSessionId(),
  );
  const [tripRequestId, setTripRequestId] = useState<string | null>(null);

  const dispatchTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (dispatchTimer.current) clearInterval(dispatchTimer.current);
    };
  }, []);

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

  const runDispatch = useCallback(() => {
    setDispatchRows(createDispatchRows());
    setOverlay("dispatch");
    let index = 0;
    dispatchTimer.current = setInterval(() => {
      index += 1;
      setDispatchRows((rows) =>
        rows.map((row, rowIndex) => ({
          ...row,
          status: rowIndex < index ? "matched" : rowIndex === index ? "matching" : "pending",
        })),
      );
      if (index >= VENDOR_ROSTER.length) {
        if (dispatchTimer.current) clearInterval(dispatchTimer.current);
        setTimeout(() => {
          setOverlay(isVerified ? "none" : "otp");
          if (isVerified) {
            setScreen("booking");
          }
        }, 500);
      }
    }, DISPATCH_ROW_INTERVAL_MS);
  }, [isVerified]);

  const submitRequest = useCallback(async () => {
    setOverlay("none");
    runDispatch();

    if (!sessionId) return;

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
      const data = (await response.json().catch(() => null)) as { trip_request_id?: string } | null;
      setTripRequestId(response.ok && typeof data?.trip_request_id === "string" ? data.trip_request_id : null);
    } catch {
      setTripRequestId(null);
    }
  }, [draft, runDispatch, sessionId]);

  const setPhone = useCallback((phone: string) => {
    setOtp((prev) => ({ ...prev, phone, error: null }));
  }, []);

  const setCode = useCallback((code: string) => {
    setOtp((prev) => ({ ...prev, code, error: null }));
  }, []);

  // Shared by both verification paths (Plan §8): OTP-code success and
  // Phone.Email fallback success both land here.
  const completeVerification = useCallback(() => {
    const quotes = buildMockQuotes(draft.days, draft.vehicleType);
    setBooking({
      bookingRef: "KMR-2381",
      summaryLabel: `${draft.days} days · ${draft.paxCount} travellers · ${draft.vehicleType.toUpperCase()}`,
      quotes,
    });
    setIsVerified(true);
    setOtp((prev) => ({ ...prev, isSubmitting: false, step: "verified", error: null }));
    setTimeout(() => {
      setOverlay("none");
      setScreen("booking");
    }, 900);
  }, [draft.days, draft.paxCount, draft.vehicleType]);

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

  return {
    screen,
    overlay,
    sheetStep,
    draft,
    dispatchRows,
    otp,
    booking,
    recommendation,
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
