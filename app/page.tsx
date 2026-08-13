"use client";

import { MobileShell } from "@/components/ui/MobileShell";
import { BottomNav } from "@/components/ui/BottomNav";
import { useBookingFlow } from "@/features/booking-request/hooks/useBookingFlow";
import { HomeHero } from "@/features/booking-request/components/HomeHero";
import { RequestSheet } from "@/features/booking-request/components/RequestSheet";
import { DispatchScreen } from "@/features/quote-dispatch/components/DispatchScreen";
import { WhatsAppOtpSheet } from "@/features/whatsapp-otp/components/WhatsAppOtpSheet";
import { BookingStatusScreen } from "@/features/booking-status/components/BookingStatusScreen";
import { ProfileScreen } from "@/features/profile/components/ProfileScreen";

export default function Home() {
  const flow = useBookingFlow();
  const showBottomNav = flow.overlay === "none";

  return (
    <MobileShell>
      {flow.screen === "home" && (
        <HomeHero onOpenRequest={flow.openSheet} onApplyPreset={flow.applyPreset} />
      )}

      {flow.screen === "booking" &&
        (flow.booking ? (
          <BookingStatusScreen booking={flow.booking} />
        ) : (
          <EmptyBookingState onStart={flow.openSheet} />
        ))}

      {flow.screen === "profile" && (
        <ProfileScreen
          profile={{
            phoneDisplay: flow.otp.phone ? `+91 ${flow.otp.phone}` : "Not verified yet",
            hasActiveBooking: Boolean(flow.booking),
            activeBookingLabel: flow.booking?.summaryLabel ?? null,
          }}
          onOpenBooking={flow.navigateBooking}
        />
      )}

      {flow.overlay === "sheet" && (
        <RequestSheet
          step={flow.sheetStep}
          draft={flow.draft}
          recommendation={flow.recommendation}
          requestError={flow.requestError}
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
          onVerifyPhoneEmail={flow.verifyPhoneEmail}
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
    </MobileShell>
  );
}

function EmptyBookingState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-[30px] pb-[90px] text-center">
      <span className="font-mono text-[9px] font-semibold tracking-[1.5px] text-kmr-muted-3">
        NO ACTIVE BOOKING
      </span>
      <h1 className="font-archivo text-2xl font-extrabold tracking-[-0.5px] text-kmr-ink">
        Request your first quote.
      </h1>
      <button
        type="button"
        onClick={onStart}
        className="rounded-sm bg-kmr-blue px-5 py-3 font-archivo text-sm font-bold text-white"
      >
        Add cabs to your trip
      </button>
    </div>
  );
}
