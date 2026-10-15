/**
 * Shared timing math for the "matching" → "verified" handoff
 * (features/booking-request/hooks/useBookingFlow.ts `completeVerification`).
 *
 * The matching screen's row animation is purely cosmetic — the real vendor
 * match already happened server-side — but per the approved design it should
 * never look cut short: if a tourist verifies their WhatsApp number before
 * the animation's nominal duration has elapsed, the "You're in." success
 * beat holds the screen until the animation would have finished anyway.
 * Only once that's true (or the caller never started a matching animation at
 * all, e.g. the "Already booked?" resume flow) do we fall back to the
 * baseline success-beat duration.
 */
export function computeVerifiedTransitionDelayMs(
  elapsedSinceDispatchStartMs: number,
  dispatchDelayMs: number,
  successBeatMs: number,
): number {
  const remainingDispatchMs = Math.max(0, dispatchDelayMs - elapsedSinceDispatchStartMs);
  return Math.max(successBeatMs, remainingDispatchMs);
}
