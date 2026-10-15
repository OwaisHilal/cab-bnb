/**
 * Test-only "Cancel request" control. Off unless this is exactly "true".
 * NEXT_PUBLIC_ so the trip screen can hide the button, and the cancel route
 * reads the same value so a hidden button cannot still abandon a trip.
 */
export const isCancelRequestEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_ENABLE_CANCEL_REQUEST === "true"
