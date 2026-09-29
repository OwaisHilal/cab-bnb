"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MobileShell } from "@/components/ui/MobileShell";
import { BottomNav } from "@/components/ui/BottomNav";
import { useBookingFlow } from "@/features/booking-request/hooks/useBookingFlow";
import { HomeHero } from "@/features/booking-request/components/HomeHero";
import { RequestSheet } from "@/features/booking-request/components/RequestSheet";
import { DispatchScreen } from "@/features/quote-dispatch/components/DispatchScreen";
import { WhatsAppOtpSheet } from "@/features/whatsapp-otp/components/WhatsAppOtpSheet";
import { ProfileScreen } from "@/features/profile/components/ProfileScreen";
import { DemoAdminLink } from "@/features/admin-debug/components/DemoAdminLink";
import { GuestTripScreen } from "@/features/guest-trip/components/GuestTripScreen";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const flow = useBookingFlow();
  const router = useRouter();
  const searchParams = useSearchParams();
  const continueRequested = searchParams.get("continue") === "1";
  const confirmingParam = searchParams.get("confirming");
  const confirming = confirmingParam === "balance" || confirmingParam === "token" ? confirmingParam : null;
  const showBottomNav = flow.overlay === "none";

  useEffect(() => {
    if (!continueRequested) return;
    flow.navigateBooking();
  }, [continueRequested, flow.navigateBooking]);

  useEffect(() => {
    if (!continueRequested || flow.screen !== "booking" || flow.overlay !== "none") return;
    if (!flow.booking) return;
    router.replace("/");
  }, [continueRequested, flow.booking, flow.overlay, flow.screen, router]);

  return (
    <MobileShell>
      {flow.screen === "home" && (
        <HomeHero onOpenRequest={flow.openSheet} onApplyPreset={flow.applyPreset} onContinue={flow.openResume} />
      )}

      {flow.screen === "booking" && flow.sessionId ? (
        <GuestTripScreen
          sessionId={flow.sessionId}
          confirming={confirming}
          notice={flow.tripNotice}
          onMissing={() => {
            if (continueRequested) flow.openResume();
          }}
          onClosed={flow.clearBooking}
          onCancel={flow.clearBooking}
          onStartRequest={flow.openSheet}
          onContinue={flow.openResume}
        />
      ) : null}

      {flow.screen === "booking" && !flow.sessionId ? (
        <EmptyBookingState onStart={flow.openSheet} onContinue={flow.openResume} />
      ) : null}

      {flow.screen === "profile" && (
        <ProfileScreen
          profile={{
            phoneDisplay: flow.otp.phone ? `+91 ${flow.otp.phone}` : "Not verified yet",
            hasActiveBooking: Boolean(flow.booking),
            activeBookingLabel: flow.booking?.summaryLabel ?? null,
          }}
          onOpenBooking={flow.navigateBooking}
          onClearBooking={flow.clearBooking}
        />
      )}

      {flow.overlay === "sheet" && (
        <RequestSheet
          step={flow.sheetStep}
          draft={flow.draft}
          recommendation={flow.recommendation}
          requestError={flow.requestError}
          isSubmitting={flow.isSubmittingRequest}
          onClose={flow.closeSheet}
          onStepChange={flow.goToStep}
          onDaysChange={flow.setDays}
          onPaxChange={flow.setPaxCount}
          onVehicleChange={flow.setVehicleType}
          onSelectDate={flow.selectDate}
          onCustomDate={flow.setCustomDate}
          onSubmit={flow.submitRequest}
        />
      )}

      {flow.overlay === "dispatch" && (
        <DispatchScreen
          rows={flow.dispatchRows}
          summaryLabel={`${flow.draft.days} days · ${flow.draft.paxCount} travellers · ${flow.draft.vehicleType.toUpperCase()}`}
          requestRef={flow.requestRef}
        />
      )}

      {flow.overlay === "otp" && (
        <WhatsAppOtpSheet
          otp={flow.otp}
          onPhoneChange={flow.setPhone}
          onCodeChange={flow.setCode}
          onSendOtp={flow.sendOtp}
          onVerifyOtp={flow.verifyOtp}
          onEditPhone={flow.editPhone}
          onBeforePhoneEmailRedirect={flow.persistPhoneEmailResumeState}
        />
      )}

      {showBottomNav && (
        <BottomNav
          active={flow.screen}
          hasActiveBooking={Boolean(flow.booking)}
          onNavigate={(tab) => {
            if (tab === "home") flow.navigateHome();
            if (tab === "booking") flow.navigateBooking();
            if (tab === "profile") flow.navigateProfile();
          }}
        />
      )}

      <DemoAdminLink />
    </MobileShell>
  );
}

function EmptyBookingState({ onStart, onContinue }: { onStart: () => void; onContinue: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-[30px] pb-[90px] text-center">
      <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">NO ACTIVE BOOKING</span>
      <h1 className="font-archivo text-2xl font-extrabold tracking-[-0.5px] text-kmr-ink">Request your first quote.</h1>
      <button
        type="button"
        aria-label="Continue with your phone"
        onClick={onContinue}
        className="rounded-sm bg-kmr-blue px-5 py-3 font-archivo text-sm font-bold text-white"
      >
        Continue with your phone
      </button>
      <button type="button" onClick={onStart} className="font-archivo text-sm font-bold text-kmr-ink underline">
        Add cabs to your trip
      </button>
    </div>
  );
}
