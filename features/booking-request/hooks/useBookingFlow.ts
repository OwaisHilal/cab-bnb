"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_PAX_COUNT,
  MAX_TRIP_DAYS,
  MIN_PAX_COUNT,
  MIN_TRIP_DAYS,
  SEDAN_SEAT_CAPACITY,
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
import type { OtpState } from "@/features/whatsapp-otp/types";
import type { BookingSummaryUi, QuoteRowUi } from "@/features/booking-status/types";

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

  const submitRequest = useCallback(() => {
    setOverlay("none");
    runDispatch();
  }, [runDispatch]);

  const setPhone = useCallback((phone: string) => {
    setOtp((prev) => ({ ...prev, phone, error: null }));
  }, []);

  const setCode = useCallback((code: string) => {
    setOtp((prev) => ({ ...prev, code, error: null }));
  }, []);

  const sendOtp = useCallback(() => {
    if (otp.phone.replace(/\D/g, "").length < 10) {
      setOtp((prev) => ({ ...prev, error: "Enter a valid 10-digit number" }));
      return;
    }
    setOtp((prev) => ({ ...prev, isSubmitting: true }));
    setTimeout(() => {
      setOtp((prev) => ({ ...prev, isSubmitting: false, step: "code" }));
    }, 500);
  }, [otp.phone]);

  const verifyOtp = useCallback(() => {
    if (otp.code.length < OTP_CODE_LENGTH) {
      setOtp((prev) => ({ ...prev, error: `Enter the ${OTP_CODE_LENGTH}-digit code` }));
      return;
    }
    setOtp((prev) => ({ ...prev, isSubmitting: true }));
    setTimeout(() => {
      const quotes = buildMockQuotes(draft.days, draft.vehicleType);
      setBooking({
        bookingRef: "KMR-2381",
        summaryLabel: `${draft.days} days · ${draft.paxCount} travellers · ${draft.vehicleType.toUpperCase()}`,
        quotes,
      });
      setIsVerified(true);
      setOtp((prev) => ({ ...prev, isSubmitting: false, step: "verified" }));
      setTimeout(() => {
        setOverlay("none");
        setScreen("booking");
      }, 900);
    }, 600);
  }, [draft.days, draft.paxCount, draft.vehicleType, otp.code.length]);

  const editPhone = useCallback(() => {
    setOtp((prev) => ({ ...prev, step: "phone", code: "", error: null }));
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
    editPhone,
  };
}

export type BookingFlow = ReturnType<typeof useBookingFlow>;
