"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { INDIAN_PHONE_DIGITS, OTP_CODE_LENGTH } from "@/features/whatsapp-otp/types";
import type { OtpDeliveryChannel, OtpState } from "@/features/whatsapp-otp/types";
import { PhoneEmailAdapter } from "@/features/phone-email/components/PhoneEmailAdapter";
import { formatIndianPhoneDisplay, isValidIndianMobile } from "@/lib/utils/phone";

interface WhatsAppOtpSheetProps {
  otp: OtpState;
  onPhoneChange: (phone: string) => void;
  onCodeChange: (code: string) => void;
  onSendOtp: (prefer?: "whatsapp") => void;
  onVerifyOtp: () => void;
  onEditPhone: () => void;
  onBeforePhoneEmailRedirect: () => void;
}

const CODE_ENTRY_COPY: Record<Exclude<OtpDeliveryChannel, "phone_email">, string> = {
  whatsapp: "Enter the code from WhatsApp.",
  sms: "Enter the code from SMS.",
};

/**
 * Plan §5: quotes are matched instantly server-side; this sheet gates quote
 * delivery behind phone verification. SMS SendOTP is the primary code
 * channel; quotes still land on WhatsApp after verify.
 */
export function WhatsAppOtpSheet({
  otp,
  onPhoneChange,
  onCodeChange,
  onSendOtp,
  onVerifyOtp,
  onEditPhone,
  onBeforePhoneEmailRedirect,
}: WhatsAppOtpSheetProps) {
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const phoneDigitCount = otp.phone.length;
  const phoneIsComplete = phoneDigitCount === INDIAN_PHONE_DIGITS;
  const phoneIsValid = isValidIndianMobile(otp.phone);
  const codeIsComplete = otp.code.length === OTP_CODE_LENGTH;

  useEffect(() => {
    if (otp.step === "phone") {
      phoneInputRef.current?.focus();
    }
    if (otp.step === "code") {
      codeInputRef.current?.focus();
    }
  }, [otp.step]);

  const handlePhoneKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && phoneIsValid && !otp.isSubmitting) {
      event.preventDefault();
      console.info("[otp ui] send sms click");
      onSendOtp();
    }
  };

  const handleCodeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && codeIsComplete && !otp.isSubmitting) {
      event.preventDefault();
      onVerifyOtp();
    }
  };

  const handleSendSmsClick = () => {
    console.info("[otp ui] send sms click");
    onSendOtp();
  };

  const handleResendCodeClick = () => {
    console.info("[otp ui] resend click");
    onSendOtp();
  };

  const handleTryWhatsAppOtpClick = () => {
    console.info("[otp ui] try whatsapp click");
    onSendOtp("whatsapp");
  };

  return (
    <>
      <div className="absolute inset-0 animate-kmr-fade bg-black/45" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[92%] flex-col gap-3.5 overflow-y-auto rounded-t-xl bg-white px-5 pb-7 pt-3.5 animate-kmr-sheet-up">
        <span className="mx-auto h-1 w-9 rounded-full bg-black/15" />

        {otp.step === "phone" && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-[38px] flex-none items-center justify-center rounded-full bg-kmr-green">
                <WhatsAppIcon />
              </span>
              <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-green-dark">
                VERIFY TO SEE QUOTES
              </span>
            </div>
            <h2 className="font-archivo text-[23px] font-extrabold leading-[1.15] tracking-[-0.5px] text-kmr-ink">
              Your quotes are matched. Verify your number to see them.
            </h2>
            <p className="font-archivo text-[12.5px] font-medium leading-[1.55] text-kmr-muted-1">
              Every matched vendor quote lands in your WhatsApp chat the moment
              you&apos;re verified. Compare, negotiate, and book — all from the chat.
            </p>
            <div className="flex flex-col gap-1.5">
              <ChecklistItem>EVERY MATCHED QUOTE, SENT TO YOUR CHAT</ChecklistItem>
              <ChecklistItem>CHAT &amp; BOOK WITHOUT REOPENING THE APP</ChecklistItem>
              <ChecklistItem>NO CALLS, NO SPAM — JUST YOUR QUOTES</ChecklistItem>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="otp-mobile" className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
                YOUR MOBILE NUMBER
              </label>
              <div className="flex gap-2">
                <span
                  className="flex h-[52px] flex-none items-center justify-center rounded-sm bg-kmr-surface px-3 font-mono text-sm font-semibold text-kmr-ink"
                  aria-hidden="true"
                >
                  +91
                </span>
                <input
                  ref={phoneInputRef}
                  id="otp-mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  maxLength={INDIAN_PHONE_DIGITS + 1}
                  value={formatIndianPhoneDisplay(otp.phone)}
                  onChange={(event) => onPhoneChange(event.target.value)}
                  onKeyDown={handlePhoneKeyDown}
                  aria-invalid={phoneIsComplete && !phoneIsValid}
                  aria-describedby="otp-mobile-hint"
                  className="min-w-0 flex-1 rounded-sm bg-kmr-surface px-3.5 font-mono text-base font-semibold tracking-[1px] text-kmr-ink outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-kmr-blue/40"
                  style={{ height: 52 }}
                />
              </div>
              <span
                id="otp-mobile-hint"
                className="font-mono text-[9px] font-medium tracking-[0.5px] text-kmr-muted-3"
              >
                {phoneDigitCount === 0
                  ? "10-digit Indian mobile number"
                  : phoneIsComplete
                    ? phoneIsValid
                      ? "Looks good — tap below to get your code"
                      : "Must start with 6, 7, 8, or 9"
                    : `${phoneDigitCount}/${INDIAN_PHONE_DIGITS} digits`}
              </span>
            </div>
            {otp.error && (
              <span className="font-mono text-[10px] font-semibold text-kmr-orange">
                {otp.error}
              </span>
            )}
            <Button
              onClick={handleSendSmsClick}
              loading={otp.isSubmitting}
              loadingLabel="Sending…"
              disabled={!phoneIsValid}
            >
              Send SMS code
            </Button>
            <span className="text-center font-mono text-[9px] font-medium tracking-[1px] text-kmr-muted-3">
              ONE-TIME CODE TO VERIFY — QUOTES FOLLOW ON WHATSAPP
            </span>
          </div>
        )}

        {otp.step === "code" && (
          <div className="flex flex-col gap-3.5">
            <h2 className="font-archivo text-[23px] font-extrabold leading-[1.15] tracking-[-0.5px] text-kmr-ink">
              {otp.deliveryChannel && otp.deliveryChannel !== "phone_email"
                ? CODE_ENTRY_COPY[otp.deliveryChannel]
                : CODE_ENTRY_COPY.sms}
            </h2>
            <p className="font-archivo text-xs font-medium text-kmr-muted-2">
              Sent to +91 {formatIndianPhoneDisplay(otp.phone)} ·{" "}
              <button type="button" onClick={onEditPhone} className="text-kmr-blue underline">
                change
              </button>
            </p>
            <input
              ref={codeInputRef}
              type="tel"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_CODE_LENGTH}
              placeholder={"·".repeat(OTP_CODE_LENGTH)}
              value={otp.code}
              onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH))}
              onKeyDown={handleCodeKeyDown}
              aria-label="One-time verification code"
              className="box-border w-full rounded-sm bg-kmr-surface text-center font-mono text-[30px] font-extrabold tracking-[14px] text-kmr-blue outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-kmr-blue/40"
              style={{ height: 64 }}
            />
            {otp.error && (
              <span className="text-center font-mono text-[10px] font-semibold text-kmr-orange">
                {otp.error}
              </span>
            )}
            <Button
              onClick={onVerifyOtp}
              loading={otp.isSubmitting}
              loadingLabel="Verifying…"
              disabled={!codeIsComplete}
            >
              Verify & see my quotes
            </Button>
            <button
              type="button"
              onClick={handleResendCodeClick}
              disabled={otp.isSubmitting}
              className="text-center font-mono text-[9px] font-medium tracking-[1px] text-kmr-blue underline disabled:opacity-50"
            >
              Resend code
            </button>
          </div>
        )}

        {otp.step === "phone_email" && (
          <div className="flex flex-col gap-3.5">
            <h2 className="font-archivo text-[23px] font-extrabold leading-[1.15] tracking-[-0.5px] text-kmr-ink">
              SMS verification is unavailable.
            </h2>
            <p className="font-archivo text-[12.5px] font-medium leading-[1.55] text-kmr-muted-1">
              Verify securely with Phone.Email instead.
            </p>
            <PhoneEmailAdapter onBeforeRedirect={onBeforePhoneEmailRedirect} />
            {otp.error && (
              <span className="text-center font-mono text-[10px] font-semibold text-kmr-orange">
                {otp.error}
              </span>
            )}
            <button
              type="button"
              onClick={handleTryWhatsAppOtpClick}
              disabled={otp.isSubmitting}
              className="text-center font-mono text-[9px] font-medium tracking-[1px] text-kmr-blue underline disabled:opacity-50"
            >
              Try WhatsApp OTP
            </button>
          </div>
        )}

        {otp.step === "verified" && (
          <div className="flex flex-col items-center gap-3 px-0 py-4.5 pb-2.5 animate-kmr-pop">
            <span className="flex size-14 items-center justify-center rounded-full bg-kmr-green font-archivo text-[26px] font-extrabold text-white">
              ✓
            </span>
            <h2 className="font-archivo text-[23px] font-extrabold tracking-[-0.5px] text-kmr-ink">
              You&apos;re in.
            </h2>
            <p className="text-center font-archivo text-[12.5px] font-medium leading-[1.55] text-kmr-muted-1">
              Your matched quotes are on their way to WhatsApp. You can close the
              app — we&apos;ve got it.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function ChecklistItem({ children }: { children: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[9.5px] font-semibold tracking-[0.8px] text-[#3C3F52]">
      <span className="text-kmr-green-dark">✓</span>
      {children}
    </span>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 4a8 8 0 0 0-6.9 12L4 20l4.1-1A8 8 0 1 0 12 4Z"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9 9.5c.4 2.2 3 4.7 5.2 5.1l1.3-1.5-1.9-1-1 .5c-.8-.5-1.5-1.2-1.9-2l.5-1-1-1.9L9 9.5Z"
        fill="#fff"
      />
    </svg>
  );
}
