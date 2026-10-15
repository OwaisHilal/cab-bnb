export type DirectLookup = "pending" | "found" | "missing" | "failed"
export type CookieLookup = "pending" | "found" | "absent" | "failed"

export interface ReturnLookupState {
  continueRequested: boolean
  directLookup: DirectLookup
  cookieLookup: CookieLookup
  tripFound: boolean
  phoneEmailResumeApplied: boolean
}

/**
 * Payment-return OTP gate. The trip screen reports a missing trip only once,
 * so this stays false until both the tab-session fetch and the login-cookie
 * lookup have finished, and neither one found a trip.
 */
export const shouldOpenReturnOtp = (input: ReturnLookupState): boolean => {
  if (!input.continueRequested || input.phoneEmailResumeApplied || input.tripFound) return false
  if (input.directLookup === "pending" || input.cookieLookup === "pending") return false
  if (input.directLookup === "found" || input.cookieLookup === "found") return false
  return input.directLookup === "missing"
}
